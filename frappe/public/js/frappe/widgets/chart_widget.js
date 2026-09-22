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
		this.release_chart_watchers();
		this.invalidate_pending_fetches();
		this.invalidate_pending_renders();
		this.destroy_dashboard_chart();
		this.clear_date_range_field();
		this.set_body();
		this.make_chart();
	}

	delete(animate = true, dismissed = false) {
		this.deleted = true;
		this.release_chart_watchers();
		this.invalidate_pending_fetches();
		this.invalidate_pending_renders();
		this.clear_date_range_field();
		this.destroy_dashboard_chart();
		super.delete(animate, dismissed);
	}

	// Makes every request already in flight stale: neither its data nor its error reaches the
	// widget (RB-2).
	invalidate_pending_fetches() {
		this.fetch_sequence = (this.fetch_sequence || 0) + 1;
	}

	// Makes every render still waiting on a doctype meta load stale: when it resumes it draws
	// nothing into this widget and binds no watcher (RB-2).
	invalidate_pending_renders() {
		this.render_sequence = (this.render_sequence || 0) + 1;
	}

	// Removes the chart this widget last drew — the current one, or one whose reference was
	// dropped without it — along with the window listeners and the ResizeObserver frappe-charts
	// holds for it.
	destroy_dashboard_chart() {
		const chart = this.dashboard_chart || this.rendered_chart;

		if (chart && typeof chart.destroy === "function") {
			chart.destroy();
		}

		delete this.dashboard_chart;
		delete this.rendered_chart;
	}

	// Draws a new chart into this widget's wrapper, releasing the chart a previous draw left
	// behind first.
	create_dashboard_chart(chart_args) {
		this.destroy_dashboard_chart();
		this.dashboard_chart = frappe.utils.make_chart(this.chart_wrapper[0], chart_args);
		this.rendered_chart = this.dashboard_chart;
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

	// Fills the error container with the announced message region and the Retry control that
	// re-fetches the chart, once per container: a repeated call keeps the existing nodes (RC-1).
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
			// retries on Enter and Space, suppressing the button's native activation (RC-6)
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

	// The effective window of this widget: this instance's live selection, else this user's saved
	// setting, else the chart record's own value. from_date and to_date are returned for the
	// timespan "Select Date Range" and are null for every other timespan, whatever the selection,
	// the setting or the record hold. Decision RB-4.
	get_time_window() {
		const timespan =
			this.selected_timespan ||
			this.chart_settings.timespan ||
			this.chart_doc.timespan ||
			null;
		const uses_date_range = timespan === "Select Date Range";

		return {
			timespan: timespan,
			time_interval:
				this.selected_time_interval ||
				this.chart_settings.time_interval ||
				this.chart_doc.time_interval ||
				null,
			from_date: uses_date_range
				? this.selected_from_date ||
				  this.chart_settings.from_date ||
				  this.chart_doc.from_date ||
				  null
				: null,
			to_date: uses_date_range
				? this.selected_to_date ||
				  this.chart_settings.to_date ||
				  this.chart_doc.to_date ||
				  null
				: null,
			heatmap_year:
				this.selected_heatmap_year ||
				this.chart_settings.heatmap_year ||
				this.chart_doc.heatmap_year ||
				null,
		};
	}

	// Builds the time-window dropdowns. Every toggle label, and with it the option
	// render_chart_filters marks as checked, comes from the one window captured here. Each
	// selection handler reads the window again, after it has recorded the new selection.
	get_time_series_filters() {
		const time_window = this.get_time_window();
		let filters;
		if (this.chart_doc.type == "Heatmap") {
			filters = [
				{
					label: __(time_window.heatmap_year),
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
					label: __(time_window.time_interval),
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
					label: __(time_window.timespan),
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
							this.clear_date_range_field();

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

		return this.fetch(this.filters, true, this.args, request_sequence).then((data) => {
			if (request_sequence !== this.fetch_sequence || this.widget_disconnected()) {
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

		// The rendered control, this instance's live selection and the next save all carry the
		// window resolved here, including a window that only the saved setting or the chart
		// record held until now.
		this.selected_timespan = time_window.timespan;
		this.selected_from_date = time_window.from_date;
		this.selected_to_date = time_window.to_date;

		this.date_field_wrapper = $(
			`<div class="dashboard-date-field pull-right"></div>`
		).insertAfter(this.action_area.find(".timespan-filter"));

		this.wrap_header_for_date_field();

		this.date_range_field = frappe.ui.form.make_control({
			df: {
				fieldtype: "DateRange",
				fieldname: "from_date",
				label: __("Date Range"),
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
						const selected_window = this.get_time_window();
						this.save_chart_config_for_user({
							timespan: selected_window.timespan,
							time_interval: selected_window.time_interval,
							from_date: selected_window.from_date,
							to_date: selected_window.to_date,
						});
						this.fetch_and_update_chart();
					}
				},
			},
			parent: this.date_field_wrapper,
			render_input: 1,
		});

		// the accessible name of the rendered input, which its label row — hidden inside a
		// widget header — does not carry, and the association of that label with the input
		// this widget holds (RB-10)
		const date_range_input_id = frappe.dom.get_unique_id();

		this.date_range_field.$input.attr({
			id: date_range_input_id,
			"aria-label": __("Date Range"),
		});
		this.date_field_wrapper.find("label.control-label").attr("for", date_range_input_id);

		if (time_window.from_date && time_window.to_date) {
			this.date_range_field.set_input(time_window.from_date, time_window.to_date);
		}

		focus_input && this.date_range_field.$input.focus();
	}

	// Wraps the header of a narrow widget onto a second row, making room for the date range
	// control while the title and subtitle keep the first row, and records that this widget's
	// header is wrapped for it (RB-11).
	wrap_header_for_date_field() {
		if (this.width === "Full" || this.widget.width() >= 700) {
			return;
		}

		this.widget.addClass("date-range-header");
		this.header_wrapped_for_date_field = true;
	}

	// Returns the header to a single row, for a header this widget wrapped for its date range
	// control. A header laid out by anything else is left as it is.
	restore_header_after_date_field() {
		if (!this.header_wrapped_for_date_field) {
			return;
		}

		this.header_wrapped_for_date_field = false;
		this.widget.removeClass("date-range-header");
	}

	// Removes this instance's date range control, its datepicker and the references to both,
	// and restores the header the control was given room in.
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

		this.restore_header_after_date_field();
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
					frappe.dashboard_utils.suppress_menu_focus_restore();
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
					frappe.dashboard_utils.suppress_menu_focus_restore();
					frappe.set_route("List", this.chart_doc.document_type);
				},
			});
		} else if (this.chart_doc.chart_type === "Report") {
			actions.push({
				label: __("{0} Report", [__(this.chart_doc.report_name)]),
				action: "action-list",
				handler: () => {
					frappe.dashboard_utils.suppress_menu_focus_restore();
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

		// Restores focus on `hidden.bs.modal`, once the dialog has finished hiding (RD-2).
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

	/**
	 * Merges the given settings into this widget's settings and persists them for this user.
	 *
	 * The settings sent are a snapshot taken when the write is queued, and one write per widget
	 * is in flight at a time: each call waits for the previous one to settle before its request
	 * is sent, leaving this widget's writes in the order the calls were made. The returned
	 * promise resolves once this write has settled and never rejects; a failed request is
	 * reported to the user by the request layer.
	 *
	 * @param {Object|null} config Settings to merge, or null to send the settings as they are.
	 * @param {number} [reset] 1 clears this chart's stored settings, 0 stores them.
	 * @returns {Promise} Resolves when this write has settled.
	 */
	save_chart_config_for_user(config, reset = 0) {
		this.chart_settings = Object.assign({}, this.chart_settings, config);

		const args = {
			reset: reset,
			config: this.clone_value(this.chart_settings),
			chart_name: this.chart_doc.chart_name,
		};

		const send = () =>
			frappe.xcall(
				"frappe.desk.doctype.dashboard_settings.dashboard_settings.save_chart_config",
				args
			);

		const pending = this.chart_config_save || Promise.resolve();
		this.chart_config_save = pending.then(send).catch(() => null);

		return this.chart_config_save;
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
	 * Focuses this widget's filter button once the dialog or filter popover it opened has closed,
	 * and only while focus is on `body`, inside the closed container, or nowhere (RD-2, RD-5).
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

	// True while the keyboard sits on one of this widget's action-area controls (RB-6).
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

	// Requests this chart's data. `request_sequence` tags the request: a response, successful or
	// failed, reaches the widget only while it is still this widget's latest request (RB-2). Callers
	// that pass no sequence are tagged with the current one.
	fetch(filters, refresh = false, args, request_sequence) {
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

		const sequence = request_sequence === undefined ? this.fetch_sequence : request_sequence;
		let fetch_response = null;

		return frappe.xcall(method, args, undefined, {
			silent: true,
			// The request layer hands this the parsed response body for both outcomes, and hands
			// the error callback below nothing at all on 401/403/404/413/500/502/504/508. It runs
			// before that callback for the same request, which reads what it captured here.
			always: (response) => {
				fetch_response = response;
			},
			error: (err) => {
				// a superseded request and a disconnected widget leave the rendered chart alone
				if (sequence !== this.fetch_sequence || this.widget_disconnected()) {
					return;
				}

				this.show_error_state(this.get_fetch_error_message(err, fetch_response));
			},
		});
	}

	// Reads a displayable message out of whatever the request layer has: the argument passed to
	// the error callback (a parsed response, a jqXHR, or nothing), then `fetch_response`, the
	// response body captured for that same request, and finally a generic message.
	get_fetch_error_message(err, fetch_response = null) {
		const responses = [err, err && err.responseJSON, fetch_response].filter(
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

	// Moves the keyboard to a rendered, visible element of this widget after a retry that started
	// inside it, and only while focus has been dropped (RC-3).
	restore_focus_after_retry() {
		if (!this.retry_focus_pending) {
			return;
		}

		this.retry_focus_pending = false;

		if (!this.retry_focus_dropped()) {
			return;
		}

		const $target = this.get_retry_focus_target();

		if (!$target) {
			return;
		}

		if (!$target.is("button, a[href], input, select, textarea, [tabindex]")) {
			$target.attr("tabindex", "-1");
		}

		$target.trigger("focus");
	}

	// True while the keyboard sits on the document itself, or on an element of this widget that is
	// no longer in the document or no longer visible.
	retry_focus_dropped() {
		const focused = document.activeElement;

		if (
			!focused ||
			focused === document.body ||
			focused === document.documentElement ||
			!focused.isConnected
		) {
			return true;
		}

		return this.widget_holds_focus() && !$(focused).is(":visible");
	}

	/**
	 * The first connected and visible element of this widget that can take the keyboard once the
	 * Retry control is hidden: its action menu, the plot area, the "No Data" container, then the
	 * widget itself (RC-3).
	 *
	 * @returns {Object|null} jQuery object wrapping the focus target, or null when the widget
	 * itself is no longer rendered.
	 */
	get_retry_focus_target() {
		const candidates = [
			this.chart_actions && this.chart_actions.find("button.chart-menu"),
			this.chart_wrapper,
			this.empty,
			this.widget,
		];

		for (const $candidate of candidates) {
			const node = $candidate && $candidate.length ? $candidate[0] : null;

			if (node && node.isConnected && $(node).is(":visible")) {
				return $(node);
			}
		}

		return null;
	}

	// True once this widget has been deleted, and once its element has left the document after
	// having been in it. False for a widget whose element has not been inserted yet: a chart built
	// inside a detached container renders and binds its watchers as usual.
	widget_disconnected() {
		if (this.deleted) {
			return true;
		}

		const element = this.widget && this.widget[0];

		if (!element) {
			return false;
		}

		if (element.isConnected) {
			this.widget_was_connected = true;

			return false;
		}

		return Boolean(this.widget_was_connected);
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
		// a deleted widget, and one whose element has left the document, draw nothing
		if (this.widget_disconnected()) {
			return;
		}

		const render_sequence = (this.render_sequence = (this.render_sequence || 0) + 1);

		// True while this render is still this widget's latest and the widget is still in the
		// document: false for a render resumed after a refresh or a delete.
		const render_is_current = () =>
			render_sequence === this.render_sequence && !this.widget_disconnected();

		let setup_dashboard_chart = () => {
			// frappe.model.with_doctype() below resumes this after loading the meta, by which
			// time a refresh or a delete may have taken the widget it would draw into
			if (!render_is_current()) {
				return;
			}

			const chart_args = this.get_chart_args();

			const is_circular_chart = ["Pie", "Donut", "Percentage"].includes(this.chart_doc.type);

			if (!this.dashboard_chart) {
				this.create_dashboard_chart(chart_args);
			} else if (is_circular_chart) {
				this.recreate_chart(chart_args);
			} else {
				try {
					this.apply_axis_label_ratio(this.get_effective_axis_label_ratio());
					this.dashboard_chart.update(this.data);
				} catch (error) {
					console.warn("Chart update failed, redrawing the chart", error);
					this.recreate_chart(chart_args);
				}
			}

			this.bind_plot_area_tooltip();
			this.make_chart_keyboard_accessible();
			this.bind_axis_label_resize();
			this.watch_chart_value_labels();
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

			if (!render_is_current()) {
				return;
			}

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
		this.create_dashboard_chart(chart_args);
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

	// Axis options that keep the x labels of this widget legible at its current width, thinning them
	// whether or not the width can be measured yet.
	get_axis_label_options() {
		if (!["Line", "Bar"].includes(this.chart_doc.type)) {
			return {};
		}

		return Object.assign(
			{ xIsSeries: 1 },
			frappe.utils.get_axis_label_options(this.data?.labels, this.get_chart_plot_width())
		);
	}

	// Re-applies the x label density of this widget on a debounced (200 ms) window resize and on a
	// resize of its chart wrapper, which covers a width change the window does not report (RA-4).
	// release_chart_watchers() drops both on refresh, on delete and when the wrapper is replaced,
	// and a resize that finds the widget gone from the document releases them as well.
	bind_axis_label_resize() {
		if (!this.dashboard_chart || this.widget_disconnected()) {
			return;
		}

		const wrapper = (this.chart_wrapper && this.chart_wrapper[0]) || null;

		if (this.axis_label_resize_handler) {
			if (this.axis_label_resize_wrapper === wrapper) {
				return;
			}

			this.release_chart_watchers();
		}

		this.axis_label_resize_handler = frappe.utils.debounce(() => {
			if (!this.dashboard_chart || !this.widget || this.widget_disconnected()) {
				this.release_chart_watchers();
				return;
			}

			this.update_axis_label_density();
		}, 200);

		this.axis_label_resize_wrapper = wrapper;
		$(window).on("resize", this.axis_label_resize_handler);
		this.observe_chart_wrapper_resize(wrapper);
	}

	// Feeds a width change of `wrapper` into the debounced density handler, which redraws once per
	// resize storm. A callback that measures the plot width it was observed at — the observer's own
	// first callback, and every height-only change — redraws nothing.
	observe_chart_wrapper_resize(wrapper) {
		if (typeof ResizeObserver !== "function" || !wrapper) {
			return;
		}

		this.axis_label_resize_plot_width = this.get_chart_plot_width();
		this.axis_label_resize_observer = new ResizeObserver(() => {
			const plot_width = this.get_chart_plot_width();

			if (plot_width === this.axis_label_resize_plot_width) {
				return;
			}

			this.axis_label_resize_plot_width = plot_width;
			this.axis_label_resize_handler && this.axis_label_resize_handler();
		});
		this.axis_label_resize_observer.observe(wrapper);
	}

	// Drops every watcher this widget holds on the rendered chart: the window resize listener with
	// its pending debounced work, the chart wrapper observer, and the value label observer.
	release_chart_watchers() {
		if (this.axis_label_resize_handler) {
			$(window).off("resize", this.axis_label_resize_handler);
			this.axis_label_resize_handler.cancel && this.axis_label_resize_handler.cancel();
			delete this.axis_label_resize_handler;
		}

		if (this.axis_label_resize_observer) {
			this.axis_label_resize_observer.disconnect();
			delete this.axis_label_resize_observer;
		}

		delete this.axis_label_resize_wrapper;
		delete this.axis_label_resize_plot_width;

		if (this.value_label_observer) {
			this.value_label_observer.disconnect();
			delete this.value_label_observer;
		}
	}

	// Re-applies the x label density of the rendered chart and redraws it when the density changed.
	update_axis_label_density() {
		if (!this.apply_axis_label_ratio(this.get_effective_axis_label_ratio())) {
			return;
		}

		this.dashboard_chart.update(this.data);
		this.format_chart_value_labels();
	}

	// The x label density this widget draws with: the ratio configured through custom options, else
	// the ratio measured for the current width.
	get_effective_axis_label_ratio() {
		return (
			this.get_configured_axis_label_ratio() ||
			this.get_axis_label_options().seriesLabelSpaceRatio
		);
	}

	// The `axisOptions.seriesLabelSpaceRatio` this widget's custom options set, the chart record's
	// options winning over this instance's, or undefined when neither sets one.
	get_configured_axis_label_ratio() {
		const sources = [this.custom_options, this.chart_doc && this.chart_doc.custom_options];
		let ratio;

		for (const source of sources) {
			const axis_options = this.parse_custom_options(source).axisOptions;

			if (axis_options && axis_options.seriesLabelSpaceRatio !== undefined) {
				ratio = axis_options.seriesLabelSpaceRatio;
			}
		}

		return ratio;
	}

	// A custom options value as an object: a JSON string is parsed, an object is taken as it is, and
	// anything else — a malformed JSON string included — is an empty object.
	parse_custom_options(options) {
		if (!options) {
			return {};
		}

		if (typeof options === "object") {
			return options;
		}

		if (typeof options !== "string") {
			return {};
		}

		try {
			const parsed = JSON.parse(options);

			return parsed && typeof parsed === "object" ? parsed : {};
		} catch (error) {
			return {};
		}
	}

	// Writes `ratio` to the config frappe-charts reads on every redraw and returns whether that
	// changed the config. A falsy ratio is written as undefined, the library's unset value.
	apply_axis_label_ratio(ratio) {
		const chart = this.dashboard_chart;

		if (!chart || !chart.config) {
			return false;
		}

		const value = ratio || undefined;

		if (chart.config.seriesLabelSpaceRatio === value) {
			return false;
		}

		chart.config.seriesLabelSpaceRatio = value;

		return true;
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

	// The finite number a dataset value holds: the number itself, or the number a non-blank
	// numeric string spells. A blank string, a boolean, an object, null, undefined, NaN and
	// Infinity hold no number and return null.
	chart_value_number(value) {
		if (typeof value === "number") {
			return Number.isFinite(value) ? value : null;
		}

		if (typeof value !== "string" || !value.trim()) {
			return null;
		}

		const number = Number(value);

		return Number.isFinite(number) ? number : null;
	}

	// The running total of `datasets` at each point index, summed over the values that hold a
	// number. An index no dataset holds a number at carries no total.
	get_stacked_chart_totals(datasets) {
		const totals = [];

		datasets.forEach((dataset) => {
			const values = (dataset && dataset.values) || [];

			values.forEach((value, point_index) => {
				const number = this.chart_value_number(value);

				if (number === null) {
					return;
				}

				totals[point_index] = (totals[point_index] || 0) + number;
			});
		});

		return totals;
	}

	format_chart_value_labels() {
		const chart = this.dashboard_chart;

		if (!chart || !chart.config || !chart.config.valuesOverPoints) {
			return;
		}

		const datasets = (this.data && this.data.datasets) || [];
		const stacked = !!(chart.barOptions && chart.barOptions.stacked);
		// a stacked chart prints the running total of every dataset over its top bar layer
		const totals = stacked ? this.get_stacked_chart_totals(datasets) : null;
		const top_layer = datasets.length - 1;

		this.chart_wrapper.find("g.dataset-units").each((_index, layer) => {
			const layer_class = layer.getAttribute("class") || "";
			const dataset = layer_class.match(/\bdataset-(\d+)\b/);

			if (!dataset) {
				return;
			}

			const cumulative =
				stacked && cint(dataset[1]) === top_layer && /\bdataset-bars\b/.test(layer_class);
			const values = cumulative ? totals : datasets[cint(dataset[1])]?.values;

			if (!values) {
				return;
			}

			layer.querySelectorAll("text.data-point-value").forEach((node) => {
				const point_index = node.parentNode?.getAttribute("data-point-index");

				if (point_index === null || point_index === undefined) {
					return;
				}

				const value = this.chart_value_number(values[cint(point_index)]);

				if (value === null) {
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
				// hides the tooltip and is not passed on to the document (RE-4, RE-10)
				event.preventDefault();
				event.stopPropagation();
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

		const title = this.get_announcement_text(data_point.formattedLabel ?? data_point.label);
		const values = (data_point.values || [])
			.map((dataset_value) =>
				[
					this.get_announcement_text(dataset_value.title),
					this.get_announcement_text(dataset_value.formatted ?? dataset_value.value),
				]
					.filter((text) => text.length)
					.join(" ")
			)
			.filter((text) => text.length)
			.join(", ");

		return values ? `${title}: ${values}` : title;
	}

	// One fragment of the tooltip as plain text: markup removed, and the HTML entities
	// frappe-charts stores in `dataByIndex` decoded to the characters they stand for (RE-11).
	get_announcement_text(value) {
		return frappe.utils.unescape_html(strip_html(String(value ?? ""))).trim();
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
