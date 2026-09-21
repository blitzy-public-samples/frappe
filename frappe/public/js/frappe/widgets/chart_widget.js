import Widget from "./base_widget.js";

frappe.provide("frappe.widget.utils");
frappe.provide("frappe.dashboards");
frappe.provide("frappe.dashboards.chart_sources");

export default class ChartWidget extends Widget {
	constructor(opts) {
		opts.shadow = true;
		super(opts);
		this.height = this.height || 240;
		this.chart_settings = this.clone_value(this.chart_settings) || {};
	}

	// Returns a copy that shares no object with the value passed in. Documents and settings
	// held elsewhere are not modified through this widget.
	clone_value(value) {
		if (value === null || value === undefined) {
			return value;
		}

		return JSON.parse(JSON.stringify(value));
	}

	get_config() {
		return {
			name: this.name,
			chart_name: this.chart_name,
			label: this.label,
			hidden: this.hidden,
			width: this.width,
		};
	}

	refresh() {
		delete this.dashboard_chart;
		this.clear_date_range_field();
		this.set_body();
		this.make_chart();
	}

	delete(animate = true, dismissed = false) {
		this.clear_date_range_field();
		delete this.dashboard_chart;
		super.delete(animate, dismissed);
	}

	set_chart_title() {
		const max_chars = this.widget.width() < 600 ? 40 : 60;
		this.set_title(max_chars);
	}

	set_body() {
		this.widget.addClass("dashboard-widget-box");
		if (this.width == "Full") {
			this.widget.addClass("full-width");
		}
	}

	setup_container() {
		this.body.empty();

		if (this.chart_doc.type == "Heatmap") {
			this.setup_heatmap_container();
		}

		this.loading = $(
			`<div class="chart-loading-state text-extra-muted" style="height: ${
				this.height
			}px;">${__("Loading...")}</div>`
		);
		this.loading.appendTo(this.body);

		this.empty = $(
			`<div class="chart-loading-state text-extra-muted" style="height: ${
				this.height
			}px;">${__("No Data")}</div>`
		);
		this.empty.hide().appendTo(this.body);

		this.error_state = $(
			`<div class="chart-loading-state text-danger" style="height: ${this.height}px;"></div>`
		);
		this.setup_error_state_content();
		this.error_state.hide().appendTo(this.body);

		this.chart_wrapper = $(`<div></div>`);
		this.chart_wrapper.appendTo(this.body);

		// mirrors the plot-area tooltip for screen readers during keyboard navigation
		this.chart_announcer = $(
			`<div class="sr-only chart-tooltip-announcer" aria-live="polite" aria-atomic="true"></div>`
		);
		this.chart_announcer.appendTo(this.body);

		this.$heatmap_legend = null;
		this.set_chart_title();
	}

	// Fills the error container with the message region screen readers announce and the Retry
	// control that re-fetches the chart. Runs once per error container: repeated calls keep the
	// existing nodes, so no duplicate button and no duplicate handler can accumulate.
	setup_error_state_content() {
		if (!this.error_state) {
			return;
		}

		if (this.error_message && this.error_message.parent().is(this.error_state)) {
			return;
		}

		const chart_label = __(
			this.chart_doc.chart_name || this.chart_doc.name || this.label || this.name || ""
		);

		this.error_state.empty();
		this.error_message = $(`<div class="chart-error-message" role="alert"></div>`);
		this.retry_button = $(
			`<button type="button" class="btn btn-xs btn-default chart-retry"
				aria-label="${frappe.utils.escape_html(__("Retry loading {0}", [chart_label]))}"
			>${__("Retry")}</button>`
		);

		this.retry_button.on("click", () => this.retry_fetch());
		this.retry_button.on("keydown", (event) => {
			// preventDefault stops the browser's own button activation from firing a second retry
			if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
				event.preventDefault();
				this.retry_fetch();
			}
		});

		this.error_state.append(this.error_message).append(this.retry_button);
	}

	setup_heatmap_container() {
		this.widget.addClass("heatmap-chart");
		this.widget.removeClass("full-width").addClass("full-width");
		this.width = "Full";
	}

	set_summary() {
		if (!this.$summary) {
			this.$summary = $(`<div class="report-summary"></div>`).hide();
			this.head.after(this.$summary);
		} else {
			this.$summary.empty();
		}

		this.summary.forEach((summary) => {
			frappe.utils.build_summary_item(summary).appendTo(this.$summary);
		});
		this.summary.length && this.$summary.show();
	}

	make_chart() {
		this.get_settings().then(() => {
			if (!this.settings) {
				this.deleted = true;
				this.widget.remove();
				return;
			}

			if (!this.chart_settings) {
				this.chart_settings = {};
			}
			this.setup_container();
			if (!this.in_customize_mode) {
				this.pending_focus_control = this.get_focused_control();

				this.action_area.empty();
				this.prepare_chart_actions();

				if (this.chart_doc.timeseries) {
					this.render_time_series_filters();
				}
			}
			frappe.run_serially([
				() => this.prepare_chart_object(),
				() => this.setup_filter_button(),
				() => this.restore_rebuilt_control_focus(),
				() => this.fetch_and_update_chart(),
			]);
		});
	}

	render_time_series_filters() {
		this.clear_date_range_field();

		let filters = this.get_time_series_filters();
		frappe.dashboard_utils.render_chart_filters(filters, "chart-actions", this.action_area, 0);

		if (
			this.chart_doc.type != "Heatmap" &&
			this.get_time_window().timespan === "Select Date Range"
		) {
			this.render_date_range_field(false);
		}
	}

	// The window the controls display: this instance's live selection, else this user's saved
	// setting, else the chart record's own value.
	get_time_window() {
		return {
			timespan:
				this.selected_timespan ||
				this.chart_settings.timespan ||
				this.chart_doc.timespan ||
				null,
			time_interval:
				this.selected_time_interval ||
				this.chart_settings.time_interval ||
				this.chart_doc.time_interval ||
				null,
			from_date: this.selected_from_date || this.chart_settings.from_date || null,
			to_date: this.selected_to_date || this.chart_settings.to_date || null,
			heatmap_year:
				this.selected_heatmap_year ||
				this.chart_settings.heatmap_year ||
				this.chart_doc.heatmap_year ||
				null,
		};
	}

	get_time_series_filters() {
		let filters;
		if (this.chart_doc.type == "Heatmap") {
			filters = [
				{
					label: __(this.chart_settings.heatmap_year) || __(this.chart_doc.heatmap_year),
					options: frappe.dashboard_utils.get_years_since_creation(
						frappe.boot.user.creation
					),
					class: "heatmap-year-filter",
					action: (selected_item) => {
						this.selected_heatmap_year = selected_item;
						this.selection_focus_control =
							'.heatmap-year-filter [data-toggle="dropdown"]';
						this.save_chart_config_for_user({
							heatmap_year: this.selected_heatmap_year,
						});
						this.fetch_and_update_chart();
					},
				},
			];
		} else {
			filters = [
				{
					label:
						__(this.chart_settings.time_interval) || __(this.chart_doc.time_interval),
					options: ["Yearly", "Quarterly", "Monthly", "Weekly", "Daily"],
					icon: "calendar",
					class: "time-interval-filter",
					action: (selected_item) => {
						this.selected_time_interval = selected_item;
						this.selection_focus_control =
							'.time-interval-filter [data-toggle="dropdown"]';
						const time_window = this.get_time_window();
						this.save_chart_config_for_user({
							timespan: time_window.timespan,
							time_interval: this.selected_time_interval,
							from_date: time_window.from_date,
							to_date: time_window.to_date,
						});
						this.fetch_and_update_chart();
					},
				},
				{
					label: __(this.chart_settings.timespan) || __(this.chart_doc.timespan),
					options: [
						"Select Date Range",
						"Last Year",
						"Last Quarter",
						"Last Month",
						"Last Week",
					],
					class: "timespan-filter",
					action: (selected_item) => {
						this.selected_timespan = selected_item;

						if (this.selected_timespan === "Select Date Range") {
							this.selection_focus_control = ".dashboard-date-field input";
							this.render_date_range_field(true);
						} else {
							this.selection_focus_control =
								'.timespan-filter [data-toggle="dropdown"]';
							this.selected_from_date = null;
							this.selected_to_date = null;
							if (this.date_field_wrapper) {
								this.clear_date_range_field();

								// Title maybe hidden becuase of date range fields
								// in half width chart
								this.title_field.show();
								this.subtitle_field.show();
								this.head.css("flex-direction", "row");
							}

							this.save_chart_config_for_user({
								timespan: this.selected_timespan,
								time_interval: this.get_time_window().time_interval,
								from_date: null,
								to_date: null,
							});
							this.fetch_and_update_chart();
						}
					},
				},
			];
		}
		return filters;
	}

	fetch_and_update_chart() {
		this.args = this.get_time_window();

		const request_sequence = (this.fetch_sequence = (this.fetch_sequence || 0) + 1);
		const focus_control = this.selection_focus_control;
		this.selection_focus_control = null;

		return this.fetch(this.filters, true, this.args).then((data) => {
			if (request_sequence !== this.fetch_sequence) {
				return;
			}

			if (this.chart_doc.chart_type == "Report") {
				this.report_result = data;
				this.summary = data.report_summary;
				data = this.get_report_chart_data(data);
			}

			this.update_chart_object();
			this.data = data;
			return this.render().then(() => this.restore_selection_focus(focus_control));
		});
	}

	render_date_range_field(focus_input = true) {
		if (this.date_field_wrapper && this.date_field_wrapper.is(":visible")) {
			focus_input && this.date_range_field && this.date_range_field.$input.focus();
			return;
		}

		this.clear_date_range_field();

		const time_window = this.get_time_window();

		this.date_field_wrapper = $(
			`<div class="dashboard-date-field pull-right"></div>`
		).insertAfter(this.action_area.find(".timespan-filter"));

		if (this.width !== "Full" && this.widget.width() < 700) {
			this.title_field.hide();
			this.subtitle_field.hide();
			this.head.css("flex-direction", "row-reverse");
		}

		this.date_range_field = frappe.ui.form.make_control({
			df: {
				fieldtype: "DateRange",
				fieldname: "from_date",
				placeholder: __("Date Range"),
				input_class: "input-xs",
				default: [time_window.from_date, time_window.to_date],
				value: [time_window.from_date, time_window.to_date],
				reqd: 1,
				change: () => {
					let selected_date_range = this.date_range_field.get_value();
					this.selected_from_date = selected_date_range[0];
					this.selected_to_date = selected_date_range[1];
					this.selection_focus_control = ".dashboard-date-field input";

					if (selected_date_range && selected_date_range.length == 2) {
						this.save_chart_config_for_user({
							timespan: this.selected_timespan,
							time_interval: this.get_time_window().time_interval,
							from_date: this.selected_from_date,
							to_date: this.selected_to_date,
						});
						this.fetch_and_update_chart();
					}
				},
			},
			parent: this.date_field_wrapper,
			render_input: 1,
		});

		if (time_window.from_date && time_window.to_date) {
			this.date_range_field.set_input(time_window.from_date, time_window.to_date);
		}

		focus_input && this.date_range_field.$input.focus();
	}

	// Removes this instance's date range control, its datepicker and the references to both.
	clear_date_range_field() {
		if (this.date_range_field) {
			const datepicker = this.date_range_field.datepicker;
			datepicker && datepicker.destroy && datepicker.destroy();
			this.date_range_field = null;
		}

		if (this.date_field_wrapper) {
			this.date_field_wrapper.remove();
			this.date_field_wrapper = null;
		}
	}

	get_report_chart_data(result) {
		if (result.chart && this.chart_doc.use_report_chart) {
			return result.chart.data;
		} else {
			let y_fields = [];
			this.chart_doc.y_axis.map((field) => {
				y_fields.push(field.y_field);
			});

			let chart_fields = {
				y_fields: y_fields,
				x_field: this.chart_doc.x_field,
				chart_type: this.chart_doc.type,
				color: this.chart_doc.color,
			};
			let columns = result.columns.map((col) => {
				return frappe.report_utils.prepare_field_from_column(col);
			});

			return frappe.report_utils.make_chart_options(columns, result, chart_fields).data;
		}
	}

	prepare_chart_actions() {
		let actions = [
			{
				label: __("Refresh"),
				action: "action-refresh",
				handler: () => {
					delete this.dashboard_chart;
					this.make_chart();
				},
			},
			{
				label: __("Edit"),
				action: "action-edit",
				handler: () => {
					frappe.set_route("Form", "Dashboard Chart", this.chart_doc.name);
				},
			},
			{
				label: __("Reset Chart"),
				action: "action-reset",
				handler: () => {
					this.reset_chart();
					delete this.dashboard_chart;
					this.make_chart();
				},
			},
			{
				label: __("Export"),
				action: "action-export",
				handler: () => {
					const data = [[this.chart_doc.chart_name]];
					data.push([]);
					data.push([]);

					const datasets = this.data?.datasets || [];
					const labels = (this.data?.labels || []).map((label) => label || "None");
					if (datasets.length > 1) {
						const csv_labels = [];
						const csv_values = [];
						labels.forEach((label, idx) => {
							datasets.forEach((element) => {
								csv_labels.push(`${element.name} (${label})`);
								const values = element.values || [];
								if (idx < values.length) {
									csv_values.push(values[idx]);
								} else {
									csv_values.push("");
								}
							});
						});
						data.push(["", ...csv_labels]);
						data.push(["", ...csv_values]);
					} else if (datasets.length === 1) {
						datasets.forEach((element) => {
							const values = element.values || [];
							if (values.length > 0) {
								data.push(["", ...labels]);
								data.push(["", ...values]);
							}
						});
					} else {
						data.push(["", ...labels]);
					}
					frappe.tools.downloadify(data, null, this.chart_doc.chart_name);
				},
			},
		];

		if (this.chart_doc.document_type) {
			actions.push({
				label: __("{0} List", [__(this.chart_doc.document_type)]),
				action: "action-list",
				handler: () => {
					frappe.set_route("List", this.chart_doc.document_type);
				},
			});
		} else if (this.chart_doc.chart_type === "Report") {
			actions.push({
				label: __("{0} Report", [__(this.chart_doc.report_name)]),
				action: "action-list",
				handler: () => {
					frappe.set_route("query-report", this.chart_doc.report_name, this.filters);
				},
			});
		}
		this.set_chart_actions(actions);
	}

	setup_filter_button() {
		if (this.in_customize_mode) return;

		this.is_document_type =
			this.chart_doc.chart_type !== "Report" && this.chart_doc.chart_type !== "Custom";

		this.filter_button = $(
			`<button type="button" class="filter-chart btn btn-xs pull-right"
				aria-haspopup="dialog" aria-label="${__("Set Filters")}" title="${__("Set Filters")}">
				${frappe.utils.icon("funnel", "sm")}
			</button>`
		);

		this.filter_button.appendTo(this.action_area);

		this.filter_button.on("hidden.bs.popover", () => {
			this.restore_focus_to_filter_button(this.filter_group && this.filter_group.wrapper);
		});

		if (this.is_document_type) {
			if (this.filter_group) {
				this.filters = this.filter_group.get_filters();
			}
			this.create_filter_group_and_add_filters();
		} else {
			this.filter_button.on("click", () => {
				let fields;

				frappe.dashboard_utils
					.get_filters_for_chart_type(this.chart_doc)
					.then((filters) => {
						if (!this.is_document_type) {
							if (!filters) {
								fields = [
									{
										fieldtype: "HTML",
										options: __("No Filters Set"),
									},
								];
							} else {
								fields = filters
									.filter((df) => df.fieldname)
									.map((df) => {
										Object.assign(df, df.dashboard_config || {});
										return df;
									});
							}
						} else {
							fields = [
								{
									fieldtype: "HTML",
									fieldname: "filter_area",
								},
							];
						}

						this.setup_filter_dialog(fields);
					});
			});
		}
	}

	setup_filter_dialog(fields) {
		let me = this;
		let dialog = new frappe.ui.Dialog({
			title: __("Set Filters for {0}", [__(this.chart_doc.chart_name)]),
			fields: fields,
			primary_action: function () {
				let values = this.get_values();
				if (values) {
					this.hide();
					me.filters = values;
					me.save_chart_config_for_user({ filters: me.filters });
					me.fetch_and_update_chart();
				}
			},
			primary_action_label: __("Set"),
		});

		// Bound to `hidden.bs.modal` rather than the dialog's `onhide`: the Desk's global
		// Escape handler blurs the active element while the dialog is still hiding.
		dialog.$wrapper.on("hidden.bs.modal", () =>
			this.restore_focus_to_filter_button(dialog.$wrapper)
		);

		dialog.show();

		if (this.chart_doc.chart_type == "Report") {
			//Set query report object so that it can be used while fetching filter values in the report
			frappe.query_report = new frappe.views.QueryReport({ filters: dialog.fields_list });
			frappe.query_reports[this.chart_doc.report_name].onload &&
				frappe.query_reports[this.chart_doc.report_name].onload(frappe.query_report);
		}
		dialog.set_values(this.filters);
	}

	reset_chart() {
		this.chart_settings = {};
		this.filters = null;
		this.selected_time_interval = null;
		this.selected_timespan = null;
		this.selected_heatmap_year = null;
		this.selected_from_date = null;
		this.selected_to_date = null;
		this.clear_date_range_field();
		this.save_chart_config_for_user(null, 1);
	}

	save_chart_config_for_user(config, reset = 0) {
		this.chart_settings = Object.assign({}, this.chart_settings, config);
		frappe.xcall(
			"frappe.desk.doctype.dashboard_settings.dashboard_settings.save_chart_config",
			{
				reset: reset,
				config: this.chart_settings,
				chart_name: this.chart_doc.chart_name,
			}
		);
	}

	create_filter_group_and_add_filters() {
		this.filter_group = new frappe.ui.FilterGroup({
			doctype: this.chart_doc.document_type,
			parent_doctype: this.chart_doc.parent_document_type,
			filter_button: this.filter_button,
			on_change: () => {
				this.filters = this.filter_group.get_filters();
				this.save_chart_config_for_user({
					filters: this.filters,
				});
				this.fetch_and_update_chart();
			},
		});

		this.filters &&
			frappe.model.with_doctype(this.chart_doc.document_type, () => {
				this.filter_group.add_filters_to_filter_group(this.filters);
			});
	}

	set_chart_actions(actions) {
		this.chart_actions = $(`<div class="chart-actions dropdown pull-right">
			<button data-toggle="dropdown"
				aria-haspopup="true" aria-expanded="false"
				aria-label="${__("Chart Actions")}" title="${__("Chart Actions")}"
				class="btn btn-xs btn-secondary chart-menu"
			>
				<svg class="icon icon-sm" aria-hidden="true">
					<use href="#icon-ellipsis">
					</use>
				</svg>
			</button>
			<ul class="dropdown-menu dropdown-menu-right" role="menu">
				${actions
					.map(
						(action) =>
							`<li role="none"><a class="dropdown-item" role="menuitem" tabindex="-1"
								data-action="${action.action}">${__(action.label)}</a></li>`
					)
					.join("")}
			</ul>
		</div>
		`);
		/* eslint-enable indent */

		this.chart_actions.find("a[data-action]").each((i, o) => {
			const action = o.dataset.action;
			$(o).click(actions.find((a) => a.action === action));
		});
		frappe.dashboard_utils.make_dropdown_keyboard_operable(this.chart_actions);
		this.chart_actions.appendTo(this.action_area);
	}

	/**
	 * Returns focus to this widget's filter button after the dialog or filter popover it opened
	 * has closed, so the keyboard is not dropped on `body`. Focus that the closing control moved
	 * somewhere else on purpose is left where it is.
	 *
	 * @param {Object} [$closed] jQuery object wrapping the container that just closed.
	 */
	restore_focus_to_filter_button($closed) {
		const button = this.filter_button && this.filter_button[0];
		if (!button || !button.isConnected) return;

		const focused = document.activeElement;
		const focus_inside_closed = Boolean(
			$closed && $closed.length && focused && $closed[0].contains(focused)
		);

		if (!focused || focused === document.body || focus_inside_closed) {
			button.focus();
		}
	}

	// True while the keyboard sits on one of this widget's controls, which a chart action that
	// rebuilds the control row would otherwise drop.
	action_area_holds_focus() {
		const focused = document.activeElement;
		const area = this.action_area && this.action_area[0];

		return Boolean(focused && area && area.contains(focused));
	}

	// The selector of the control in this widget's action area that holds the keyboard, matched
	// again in the rebuilt action area by restore_rebuilt_control_focus().
	get_focused_control() {
		if (!this.action_area_holds_focus()) {
			return null;
		}

		const $focused = $(document.activeElement);
		const $group = $focused.closest(
			".timespan-filter, .time-interval-filter, .heatmap-year-filter, .chart-actions"
		);

		if (!$group.length) {
			return $focused.closest(".dashboard-date-field").length
				? ".dashboard-date-field input"
				: ".filter-chart";
		}

		const filter_class = [
			"timespan-filter",
			"time-interval-filter",
			"heatmap-year-filter",
		].find((chart_filter) => $group.hasClass(chart_filter));

		return filter_class ? `.${filter_class} [data-toggle="dropdown"]` : ".chart-menu";
	}

	focus_control(selector) {
		if (!selector) {
			return;
		}

		const $control = this.action_area.find(selector).first();
		$control.length && $control.trigger("focus");
	}

	restore_rebuilt_control_focus() {
		const selector = this.pending_focus_control;
		this.pending_focus_control = null;
		this.focus_control(selector);
	}

	// Returns the keyboard to the control a selection was made from once its re-render is done,
	// for the selections that leave focus nowhere.
	restore_selection_focus(selector) {
		const focused = document.activeElement;
		const focus_lost =
			!focused || focused === document.body || focused === document.documentElement;

		focus_lost && this.focus_control(selector);
	}

	fetch(filters, refresh = false, args) {
		let method = this.settings.method;

		if (this.chart_doc.chart_type == "Report") {
			args = {
				report_name: this.chart_doc.report_name,
				filters: filters,
				ignore_prepared_report: 1,
			};
		} else {
			args = {
				chart_name: this.chart_doc.name,
				filters: filters,
				refresh: refresh ? 1 : 0,
				time_interval: args && args.time_interval ? args.time_interval : null,
				timespan: args && args.timespan ? args.timespan : null,
				from_date: args && args.from_date ? args.from_date : null,
				to_date: args && args.to_date ? args.to_date : null,
				heatmap_year: args && args.heatmap_year ? args.heatmap_year : null,
			};
		}

		this.last_fetch_response = null;

		return frappe.xcall(method, args, undefined, {
			silent: true,
			// The request layer hands this the parsed response body for both outcomes, and hands
			// the error callback below nothing at all on 401/403/404/413/500/502/504/508.
			always: (response) => {
				this.last_fetch_response = response;
			},
			error: (err) => {
				this.show_error_state(this.get_fetch_error_message(err));
			},
		});
	}

	// Reads a displayable message out of whatever the request layer has: the argument passed to
	// the error callback (a parsed response, a jqXHR, or nothing), then the response body of this
	// request, and finally a generic message.
	get_fetch_error_message(err) {
		const responses = [err, err && err.responseJSON, this.last_fetch_response].filter(
			(response) => response && typeof response === "object"
		);

		for (const response of responses) {
			const server_message = this.parse_server_message(response._server_messages);

			if (server_message) {
				return server_message;
			}
		}

		for (const response of responses) {
			if (typeof response.message === "string" && response.message.trim()) {
				return strip_html(response.message).trim();
			}

			if (typeof response.exc_type === "string" && response.exc_type) {
				return __("Could not load chart data ({0})", [response.exc_type]);
			}

			if (response.status) {
				return __("Could not load chart data (HTTP {0})", [response.status]);
			}
		}

		return __("Could not load chart data");
	}

	// Returns the first message carried by a _server_messages payload, or "" when it carries none.
	parse_server_message(server_messages) {
		if (!server_messages) {
			return "";
		}

		try {
			const messages = JSON.parse(server_messages);
			const message = messages.length ? JSON.parse(messages[0])?.message : null;

			return message ? strip_html(String(message)).trim() : "";
		} catch (e) {
			return "";
		}
	}

	// Replaces the chart with the error message and its Retry control.
	show_error_state(message) {
		if (!this.error_state) {
			return;
		}

		const focus_retry = this.retry_focus_pending || this.widget_holds_focus();
		this.retry_focus_pending = false;

		this.chart_wrapper && this.chart_wrapper.hide();
		this.loading && this.loading.hide();
		this.$summary && this.$summary.hide();
		this.empty && this.empty.hide();

		this.setup_error_state_content();
		this.error_message.text(message || __("Could not load chart data"));
		this.error_state.show();

		if (focus_retry) {
			this.retry_button.trigger("focus");
		}
	}

	// Re-fetches the chart data from the error state. fetch_and_update_chart() requests with
	// refresh: 1 and renders, and render() hides the error state once data arrives.
	retry_fetch() {
		this.retry_focus_pending = this.widget_holds_focus();

		this.error_state.hide();
		this.loading.show();
		this.fetch_and_update_chart();
	}

	// Returns the keyboard to the chart's action menu after a retry that started from the keyboard
	// or the mouse inside this widget, which hiding the Retry button would otherwise drop on body.
	restore_focus_after_retry() {
		if (!this.retry_focus_pending) {
			return;
		}

		this.retry_focus_pending = false;

		const $menu = this.chart_actions && this.chart_actions.find(".chart-menu");

		if ($menu && $menu.length) {
			$menu.trigger("focus");
		}
	}

	// True while the keyboard sits on one of this widget's own elements.
	widget_holds_focus() {
		const focused = document.activeElement;
		const widget = this.widget && this.widget[0];

		return Boolean(focused && widget && widget.contains(focused));
	}

	async get_source_doctype() {
		if (this.chart_doc.document_type) {
			return this.chart_doc.document_type;
		}
		if (this.chart_doc.chart_type == "Report" && this.chart_doc.report_name) {
			return await frappe.db
				.get_value("Report", this.chart_doc.report_name, "ref_doctype")
				.then((r) => r.message.ref_doctype);
		}
	}

	async render() {
		let setup_dashboard_chart = () => {
			const chart_args = this.get_chart_args();

			const is_circular_chart = ["Pie", "Donut", "Percentage"].includes(this.chart_doc.type);

			if (!this.dashboard_chart) {
				this.dashboard_chart = frappe.utils.make_chart(this.chart_wrapper[0], chart_args);
			} else if (is_circular_chart) {
				this.recreate_chart(chart_args);
			} else {
				try {
					this.dashboard_chart.update(this.data);
				} catch (error) {
					console.warn("Chart update failed, redrawing the chart", error);
					this.recreate_chart(chart_args);
				}
			}

			this.bind_plot_area_tooltip();
			this.make_chart_keyboard_accessible();
			this.watch_chart_value_labels();
			this.bind_axis_label_resize();
		};

		if (!this.data || !this.data.labels || !Object.keys(this.data).length) {
			this.chart_wrapper.hide();
			this.loading.hide();
			this.$summary && this.$summary.hide();
			this.empty.show();
			this.error_state.hide();
			this.restore_focus_after_retry();
		} else {
			this.loading.hide();
			this.empty.hide();
			this.error_state.hide();
			this.chart_wrapper.show();
			this.chart_doc.document_type = await this.get_source_doctype();

			if (this.chart_doc.document_type) {
				frappe.model.with_doctype(this.chart_doc.document_type, setup_dashboard_chart);
			} else {
				setup_dashboard_chart();
			}

			this.width == "Full" && this.summary && this.set_summary();
			this.chart_doc.type == "Heatmap" && this.render_heatmap_legend();
			this.restore_focus_after_retry();
		}
	}

	// Draws a new chart from the current arguments in place of the rendered one.
	recreate_chart(chart_args) {
		this.chart_wrapper.empty();
		delete this.dashboard_chart;
		this.dashboard_chart = frappe.utils.make_chart(this.chart_wrapper[0], chart_args);
	}

	// Makes the whole plot area a tooltip target on charts that print their values over points.
	bind_plot_area_tooltip() {
		const chart = this.dashboard_chart;

		if (!chart || !chart.config || !chart.config.valuesOverPoints) {
			return;
		}

		const has_axis_tooltip =
			typeof chart.mapTooltipXPosition === "function" && chart.container && chart.tip;

		if (!has_axis_tooltip || chart.plot_area_tooltip_bound) {
			return;
		}

		chart.plot_area_tooltip_bound = true;
		chart.container.addEventListener("mousemove", (event) => {
			const container_rect = chart.container.getBoundingClientRect();
			const tip_offset = chart.tip.offset || { x: 0, y: 0 };
			const plot_area_y = event.clientY - container_rect.top - tip_offset.y;

			if (plot_area_y < 0 || plot_area_y > chart.height) {
				return;
			}

			chart.mapTooltipXPosition(event.clientX - container_rect.left - tip_offset.x);
		});
	}

	// Pixels frappe-charts has for the plot area of this widget, measured on the chart wrapper and
	// falling back to the widget and to the column of the widget group while either is unrendered.
	get_chart_plot_width() {
		const measured =
			(this.chart_wrapper && this.chart_wrapper.width()) ||
			(this.widget && this.widget.width()) ||
			(this.widget && this.widget.parent().width()) ||
			0;

		return frappe.utils.get_chart_plot_width(measured);
	}

	// Axis options that keep the x labels of this widget legible at its current width.
	get_axis_label_options() {
		if (!["Line", "Bar"].includes(this.chart_doc.type)) {
			return {};
		}

		const ratio = frappe.utils.get_axis_label_space_ratio(
			this.data?.labels,
			this.get_chart_plot_width(),
			Boolean(this.chart_doc.timeseries)
		);

		return ratio ? { seriesLabelSpaceRatio: ratio } : {};
	}

	// Re-applies the x label density of this widget after the window has been resized, and drops the
	// listener once the widget has left the document.
	bind_axis_label_resize() {
		if (!this.dashboard_chart || this.axis_label_resize_handler) {
			return;
		}

		this.axis_label_resize_handler = frappe.utils.debounce(() => {
			if (!this.dashboard_chart || !this.widget || !document.body.contains(this.widget[0])) {
				this.release_chart_watchers();
				return;
			}

			this.update_axis_label_density();
		}, 200);

		$(window).on("resize", this.axis_label_resize_handler);
	}

	release_chart_watchers() {
		if (this.axis_label_resize_handler) {
			$(window).off("resize", this.axis_label_resize_handler);
			delete this.axis_label_resize_handler;
		}

		if (this.value_label_observer) {
			this.value_label_observer.disconnect();
			delete this.value_label_observer;
		}
	}

	update_axis_label_density() {
		const chart = this.dashboard_chart;
		const ratio = this.get_axis_label_options().seriesLabelSpaceRatio;

		if (!chart || !chart.config || !ratio) {
			return;
		}

		if (chart.config.seriesLabelSpaceRatio === ratio) {
			return;
		}

		chart.config.seriesLabelSpaceRatio = ratio;
		chart.update(this.data);
		this.format_chart_value_labels();
	}

	// Keeps the values printed over points in the number format of the axis ticks, including after
	// frappe-charts has re-rendered them at the end of an animation.
	watch_chart_value_labels() {
		const chart = this.dashboard_chart;

		if (!chart || !chart.config || !chart.config.valuesOverPoints) {
			return;
		}

		this.format_chart_value_labels();

		if (typeof MutationObserver !== "function") {
			return;
		}

		if (this.value_label_observer) {
			this.value_label_observer.disconnect();
		}

		this.value_label_observer = new MutationObserver(() => this.format_chart_value_labels());
		this.value_label_observer.observe(this.chart_wrapper[0], {
			childList: true,
			subtree: true,
		});
	}

	format_chart_value_labels() {
		const chart = this.dashboard_chart;

		if (!chart || !chart.config || !chart.config.valuesOverPoints) {
			return;
		}

		// a stacked bar prints cumulative totals rather than its own dataset values
		if (chart.barOptions && chart.barOptions.stacked) {
			return;
		}

		const datasets = (this.data && this.data.datasets) || [];

		this.chart_wrapper.find("g.dataset-units").each((_index, layer) => {
			const dataset = (layer.getAttribute("class") || "").match(/\bdataset-(\d+)\b/);
			const values = dataset && datasets[cint(dataset[1])]?.values;

			if (!values) {
				return;
			}

			layer.querySelectorAll("text.data-point-value").forEach((node) => {
				const point_index = node.parentNode?.getAttribute("data-point-index");

				if (point_index === null || point_index === undefined) {
					return;
				}

				const value = values[cint(point_index)];

				if (typeof value !== "number") {
					return;
				}

				const formatted = frappe.utils.format_chart_axis_number(value);

				if (node.textContent !== formatted) {
					node.textContent = formatted;
				}
			});
		});
	}

	// True when the rendered chart exposes the axis tooltip the keyboard handler drives.
	chart_supports_tooltip_navigation(chart) {
		return !!(
			chart &&
			chart.tip &&
			typeof chart.mapTooltipXPosition === "function" &&
			chart.state &&
			chart.state.xAxis &&
			chart.state.xAxis.positions &&
			chart.state.xAxis.positions.length
		);
	}

	// Turns the plot area into a labelled focus stop whose arrow keys walk the tooltip.
	make_chart_keyboard_accessible() {
		const chart = this.dashboard_chart;

		if (!this.chart_wrapper || !this.chart_supports_tooltip_navigation(chart)) {
			return;
		}

		const plot_area = this.chart_wrapper[0];

		this.chart_wrapper.addClass("chart-plot-area").attr({
			tabindex: "0",
			role: "group",
			"aria-label": __("{0} chart. Use the arrow keys to read values.", [
				__(this.chart_doc.chart_name),
			]),
		});

		// re-bounds the stored index to the label count of the chart as it now stands
		this.clamp_tooltip_index();

		if (plot_area.plot_area_keyboard_bound) {
			return;
		}

		plot_area.plot_area_keyboard_bound = true;

		this.chart_wrapper.on("keydown", (event) => this.handle_plot_area_keydown(event));
		this.chart_wrapper.on("blur", () => this.hide_plot_area_tooltip());
	}

	handle_plot_area_keydown(event) {
		const chart = this.dashboard_chart;

		if (!this.chart_supports_tooltip_navigation(chart)) {
			return;
		}

		const last_index = chart.state.xAxis.positions.length - 1;
		const current_index = this.tooltip_index;
		let next_index;

		switch (event.key) {
			case "ArrowRight":
				next_index = current_index == null ? 0 : Math.min(current_index + 1, last_index);
				break;
			case "ArrowLeft":
				next_index = current_index == null ? last_index : Math.max(current_index - 1, 0);
				break;
			case "Home":
				next_index = 0;
				break;
			case "End":
				next_index = last_index;
				break;
			case "Enter":
			case " ":
			case "Spacebar":
				next_index = current_index == null ? 0 : current_index;
				break;
			case "Escape":
				event.preventDefault();
				this.hide_plot_area_tooltip();
				return;
			default:
				// every other key, Tab included, keeps its default behaviour
				return;
		}

		event.preventDefault();
		this.move_tooltip_to(next_index);
	}

	// Shows the same tooltip the pointer shows, for the data point at `index`.
	move_tooltip_to(index) {
		const chart = this.dashboard_chart;

		if (!this.chart_supports_tooltip_navigation(chart)) {
			return;
		}

		const positions = chart.state.xAxis.positions;
		const bounded_index = Math.min(Math.max(index, 0), positions.length - 1);
		const value_label_offset = chart.config && chart.config.valuesOverPoints ? -20 : 0;

		this.tooltip_index = bounded_index;
		chart.mapTooltipXPosition(positions[bounded_index], value_label_offset);
		this.announce_tooltip(bounded_index);
	}

	hide_plot_area_tooltip() {
		const chart = this.dashboard_chart;

		if (chart && chart.tip && typeof chart.tip.hideTip === "function") {
			chart.tip.hideTip();
		}

		this.chart_announcer && this.chart_announcer.text("");
	}

	clamp_tooltip_index() {
		const point_count = this.dashboard_chart?.state?.xAxis?.positions?.length || 0;

		if (!point_count) {
			this.tooltip_index = null;
			return;
		}

		if (this.tooltip_index != null && this.tooltip_index > point_count - 1) {
			this.tooltip_index = point_count - 1;
		}
	}

	announce_tooltip(index) {
		this.chart_announcer && this.chart_announcer.text(this.get_tooltip_announcement(index));
	}

	get_tooltip_announcement(index) {
		const data_point = this.dashboard_chart?.dataByIndex?.[index];

		if (!data_point) {
			return "";
		}

		const title = strip_html(
			String(data_point.formattedLabel ?? data_point.label ?? "")
		).trim();
		const values = (data_point.values || [])
			.map((dataset_value) => {
				const value = dataset_value.formatted ?? dataset_value.value;
				const formatted_value = strip_html(String(value ?? "")).trim();
				return dataset_value.title
					? `${dataset_value.title} ${formatted_value}`
					: formatted_value;
			})
			.filter((text) => text.length)
			.join(", ");

		return values ? `${title}: ${values}` : title;
	}

	get_chart_args() {
		let colors = this.get_chart_colors();
		let fieldtype, options;

		const chart_type_map = {
			Line: "line",
			Bar: "bar",
			Percentage: "percentage",
			Pie: "pie",
			Donut: "donut",
			Heatmap: "heatmap",
		};

		let max_slices = ["Pie", "Donut"].includes(this.chart_doc.type) ? 6 : 9;
		let chart_args = {
			data: this.data,
			type: chart_type_map[this.chart_doc.type],
			colors: colors,
			height: this.height,
			maxSlices: this.chart_doc.number_of_groups || max_slices,
			truncateLegends: 0,
			axisOptions: Object.assign(
				{
					xIsSeries: this.chart_doc.timeseries,
					shortenYAxisNumbers: 1,
				},
				this.get_axis_label_options()
			),
		};

		if (this.chart_doc.document_type) {
			let doctype_meta = frappe.get_meta(this.chart_doc.document_type);
			let field = doctype_meta.fields.find(
				(x) => x.fieldname == this.chart_doc.value_based_on
			);
			fieldtype = field?.fieldtype;
			options = field?.options;
		}

		if (this.chart_doc.chart_type == "Report" && this.report_result?.chart?.fieldtype) {
			fieldtype = this.report_result.chart.fieldtype;
			options = this.report_result.chart.options;
		}

		if (this.chart_doc.chart_type == "Custom" && this.chart_doc.custom_options) {
			let chart_options = JSON.parse(this.chart_doc.custom_options);
			fieldtype = chart_options.fieldtype;
			options = chart_options.options;
		}

		if (this.chart_doc.currency) {
			chart_args.tooltipOptions = {
				formatTooltipY: (value) => format_currency(value, this.chart_doc.currency),
			};
		} else {
			chart_args.tooltipOptions = {
				formatTooltipY: (value) =>
					frappe.format(
						value,
						{ fieldtype, options },
						{ always_show_decimals: true, inline: true }
					),
			};
		}

		if (this.chart_doc.type == "Heatmap") {
			const heatmap_year = parseInt(
				this.selected_heatmap_year ||
					this.chart_settings.heatmap_year ||
					this.chart_doc.heatmap_year
			);
			chart_args.data.start = new Date(`${heatmap_year}-01-01`);
			chart_args.data.end = new Date(`${heatmap_year + 1}-01-01`);
		}
		if (this.chart_doc.show_values_over_chart) chart_args.valuesOverPoints = true;
		let set_options = (options) => {
			let custom_options = JSON.parse(options);
			for (let key in custom_options) {
				if (
					typeof chart_args[key] === "object" &&
					typeof custom_options[key] === "object"
				) {
					chart_args[key] = Object.assign(chart_args[key], custom_options[key]);
				} else {
					chart_args[key] = custom_options[key];
				}
			}
		};

		if (this.custom_options) {
			set_options(this.custom_options);
		}

		if (this.chart_doc.custom_options) {
			set_options(this.chart_doc.custom_options);
		}

		return chart_args;
	}

	get_chart_colors() {
		let colors = [];
		if (this.chart_doc.y_axis.length) {
			this.chart_doc.y_axis.map((field) => {
				colors.push(field.color);
			});
		} else if (["Line", "Bar"].includes(this.chart_doc.type)) {
			colors = [this.chart_doc.color || []];
		} else if (this.chart_doc.type == "Heatmap") {
			colors = [];
		}

		return colors;
	}

	render_heatmap_legend() {
		let legend_colors;

		let set_legend_color = (options) => {
			legend_colors = JSON.parse(options).colors;
		};

		if (this.custom_options) {
			set_legend_color(this.custom_options);
		}

		if (this.chart_doc.custom_options) {
			set_legend_color(this.chart_doc.custom_options);
		}

		if (!this.$heatmap_legend && this.widget.width() > 991) {
			this.$heatmap_legend = $(`
				<div class="heatmap-legend">
					<ul class="legend-colors">
						<li style="background-color: ${legend_colors[0] || "#ebedf0"}"></li>
						<li style="background-color: ${legend_colors[1] || "#c6e48b"}"></li>
						<li style="background-color: ${legend_colors[2] || "#7bc96f"}"></li>
						<li style="background-color: ${legend_colors[3] || "#239a3b"}"></li>
						<li style="background-color: ${legend_colors[4] || "#196127"}"></li>
					</ul>
					<div class="legend-label">
						<div style="margin-bottom: 45px">${__("Less")}</div>
						<div>${__("More")}</div>
					</div>
				</div>
				`);
			this.body.append(this.$heatmap_legend);
		}
	}

	update_last_synced() {
		if (!this.chart_doc.last_synced_on) {
			return;
		}
		let last_synced_text = __("Last synced {0}", [
			comment_when(this.chart_doc.last_synced_on),
		]);
		this.subtitle_field.html(last_synced_text);
	}

	update_chart_object() {
		frappe.db.get_doc("Dashboard Chart", this.chart_doc.name).then((doc) => {
			this.chart_doc = this.clone_value(doc);
			this.update_last_synced();
		});
	}

	prepare_chart_object() {
		if (this.chart_doc.type == "Heatmap" && !this.chart_doc.heatmap_year) {
			this.chart_doc.heatmap_year = frappe.dashboard_utils.get_year(
				frappe.datetime.now_date()
			);
		}

		return this.set_chart_filters();
	}

	set_chart_filters() {
		let user_saved_filters = this.chart_settings.filters || null;
		let chart_saved_filters = frappe.dashboard_utils.get_all_filters(this.chart_doc);

		if (this.chart_doc.chart_type == "Report") {
			return frappe.dashboard_utils
				.get_filters_for_chart_type(this.chart_doc)
				.then((filters) => {
					chart_saved_filters = this.update_default_date_filters(
						filters,
						chart_saved_filters
					);
					this.filters =
						frappe.utils.parse_array(user_saved_filters) ||
						frappe.utils.parse_array(this.filters) ||
						frappe.utils.parse_array(chart_saved_filters);
				});
		} else {
			this.filters =
				frappe.utils.parse_array(user_saved_filters) ||
				frappe.utils.parse_array(this.filters) ||
				frappe.utils.parse_array(chart_saved_filters);
			return Promise.resolve();
		}
	}

	update_default_date_filters(report_filters, chart_filters) {
		if (report_filters) {
			report_filters.map((f) => {
				if (["Date", "DateRange"].includes(f.fieldtype) && f.default) {
					if (f.reqd || chart_filters[f.fieldname]) {
						chart_filters[f.fieldname] = f.default;
					}
				}
			});
		}
		return chart_filters;
	}

	get_settings() {
		return frappe.model.with_doc("Dashboard Chart", this.chart_name).then((chart_doc) => {
			if (chart_doc) {
				this.chart_doc = this.clone_value(chart_doc);
				if (this.chart_doc.chart_type == "Custom") {
					// custom source
					if (frappe.dashboards.chart_sources[this.chart_doc.source]) {
						this.settings = frappe.dashboards.chart_sources[this.chart_doc.source];
						return Promise.resolve();
					} else {
						const method =
							"frappe.desk.doctype.dashboard_chart_source.dashboard_chart_source.get_config";
						return frappe
							.xcall(method, { name: this.chart_doc.source })
							.then((config) => {
								frappe.dom.eval(config);
								this.settings =
									frappe.dashboards.chart_sources[this.chart_doc.source];
							});
					}
				} else if (this.chart_doc.chart_type == "Report") {
					this.settings = {
						method: "frappe.desk.query_report.run",
					};
					return Promise.resolve();
				} else {
					this.settings = {
						method: "frappe.desk.doctype.dashboard_chart.dashboard_chart.get",
					};
					return Promise.resolve();
				}
			}
		});
	}
}
