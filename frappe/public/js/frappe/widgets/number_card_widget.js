import Widget from "./base_widget.js";

frappe.provide("frappe.utils");

export default class NumberCardWidget extends Widget {
	constructor(opts) {
		opts.shadow = true;
		super(opts);
	}

	get_config() {
		return {
			name: this.name,
			number_card_name: this.number_card_name,
			label: this.label,
			color: this.color,
			hidden: this.hidden,
		};
	}

	refresh() {
		this.set_body();
	}

	set_body() {
		// widget-shadow carries the tile's hover elevation
		this.widget.addClass("number-widget-box widget-shadow");
		this.make_card();
	}

	make_card() {
		frappe.model.with_doc("Number Card", this.number_card_name || this.name).then((card) => {
			if (!card) {
				if (this.document_type) {
					frappe.run_serially([
						() => this.create_number_card(),
						() => this.render_card(),
					]);
				} else {
					// widget doesn't exist so delete
					this.delete(false);
					return;
				}
			} else {
				this.card_doc = card;
				this.render_card();
			}

			this.set_events();
		});
	}

	create_number_card() {
		this.set_doc_args();
		return frappe
			.xcall("frappe.desk.doctype.number_card.number_card.create_number_card", {
				args: this.card_doc,
			})
			.then((doc) => {
				this.name = doc.name;
				this.card_doc = doc;
				this.widget.attr("data-widget-name", this.name);
			});
	}

	set_events() {
		$(this.body).click(() => {
			if (this.in_customize_mode) return;
			this.set_route();
		});

		this.update_tile_operability();
	}

	/**
	 * Switches the widget into customize mode and updates the tile's interactive semantics,
	 * which a customize-mode tile does not carry.
	 */
	customize(options) {
		super.customize(options);
		this.update_tile_operability();
	}

	/**
	 * Brings the tile's interactive semantics in line with the widget's current state: a tile
	 * that resolves to a destination is operable, and a tile in customize mode or with no
	 * destination is not.
	 *
	 * Runs on every render, on entry to customize mode, and again once `get_data()` has
	 * resolved, at which point a Custom card's route is known.
	 */
	update_tile_operability() {
		const action_name = this.in_customize_mode ? null : this.get_tile_action_name();

		if (action_name) {
			this.make_tile_operable(action_name);
		} else {
			this.make_tile_inoperable();
		}
	}

	/**
	 * Returns the accessible name of the tile's action - the card's title followed by the
	 * destination activating the tile navigates to - or null when the card resolves to no
	 * destination: a card whose document is still loading, a Report card without a report, a
	 * Document Type card without a document type, or a Custom card whose data carries no route.
	 *
	 * The destination is the document type's list view, or the document itself for a Single
	 * document type, or the card's report, or the page a Custom card's route points at.
	 */
	get_tile_action_name() {
		if (!this.card_doc) return null;

		const tile_label = __(this.title || this.label || this.name);
		const card_type = this.card_doc.type || "Document Type";

		if (card_type === "Custom") {
			const destination = this.get_custom_route_label();
			return destination ? __("{0}: open {1}", [tile_label, destination]) : null;
		}

		if (card_type === "Report") {
			if (!this.card_doc.report_name) return null;

			return __("{0}: open the {1} report", [tile_label, __(this.card_doc.report_name)]);
		}

		const document_type = this.card_doc.document_type;
		if (!document_type) return null;

		if (frappe.model.is_single(document_type)) {
			return __("{0}: open {1}", [tile_label, __(document_type)]);
		}

		return __("{0}: open the {1} list", [tile_label, __(document_type)]);
	}

	/**
	 * Returns the name of the destination a Custom card routes to, taken from the last
	 * meaningful segment of `data.route` with the desk prefix and any query string dropped, or
	 * an empty string when the card's data carries no route.
	 */
	get_custom_route_label() {
		const route = this.data?.route;
		if (!route) return "";

		const segments = (Array.isArray(route) ? route : String(route).split("/"))
			.map((segment) => String(segment).split(/[?#]/)[0].trim())
			.filter((segment) => segment && !["app", "desk"].includes(segment.toLowerCase()));

		return segments.length ? __(segments[segments.length - 1]) : "";
	}

	/**
	 * Makes the tile itself keyboard-operable: it carries a link role, the accessible name of
	 * its action and a tab stop, and Enter or Space performs the same navigation as a click on
	 * the tile body.
	 *
	 * The keydown binding is namespaced and rebound on every render, and it handles only
	 * events whose target is the tile element - keys pressed on the card actions dropdown
	 * nested inside the tile are left to that control.
	 */
	make_tile_operable(action_name) {
		this.widget.attr({
			role: "link",
			tabindex: 0,
			"aria-label": action_name,
		});

		this.widget.off("keydown.number_card").on("keydown.number_card", (e) => {
			if (e.target !== this.widget[0]) return;
			if (this.in_customize_mode) return;
			if (!["Enter", " ", "Spacebar"].includes(e.key)) return;

			e.preventDefault();
			this.set_route();
		});
	}

	/**
	 * Takes the tile's interactive semantics back off: the link role, the tab stop, the
	 * accessible action name and the tile key handler all go, leaving a plain container that
	 * is neither a tab stop nor announced as a control.
	 */
	make_tile_inoperable() {
		this.widget.removeAttr("role tabindex aria-label");
		this.widget.off("keydown.number_card");
	}

	set_route() {
		if (this.card_doc.type === "Custom") {
			this.set_route_for_custom_card();
			return;
		}

		const is_document_type = this.card_doc.type !== "Report";
		const name = is_document_type ? this.card_doc.document_type : this.card_doc.report_name;
		const route = frappe.utils.generate_route({
			name: name,
			type: is_document_type ? "doctype" : "report",
			is_query_report: !is_document_type,
		});
		const filters = this.get_filters();
		if (is_document_type) {
			frappe.route_options = filters.reduce((acc, filter) => {
				const field = filter[1];
				const value = [filter[2], filter[3]];

				// if we have multiple filters for the same field,
				// we convert it into an array
				if (acc[field]) {
					acc[field].push(value);
				} else {
					acc[field] = [value];
				}

				return acc;
			}, {});
		} else {
			if (filters && Object.keys(filters).length) {
				frappe.route_options = filters;
			}
		}

		frappe.set_route(route);
	}

	set_route_for_custom_card() {
		if (!this.data?.route) return;

		if (this.data.route_options) {
			frappe.route_options = this.data.route_options;
		}

		frappe.set_route(this.data.route);
	}

	set_doc_args() {
		this.card_doc = Object.assign(
			{},
			{
				document_type: this.document_type,
				label: this.label,
				function: this.function,
				aggregate_function_based_on: this.aggregate_function_based_on,
				color: this.color,
				filters_json: this.stats_filter,
			}
		);
	}

	get_settings(type) {
		this.filters = this.get_filters();
		const settings_map = {
			Custom: {
				method: this.card_doc.method,
				args: {
					filters: this.filters,
				},
				get_number: (res) => this.get_number_for_custom_card(res),
			},
			Report: {
				method: "frappe.desk.query_report.run",
				args: {
					report_name: this.card_doc.report_name,
					filters: this.filters,
					ignore_prepared_report: 1,
				},
				get_number: (res) => this.get_number_for_report_card(res),
			},
			"Document Type": {
				method: "frappe.desk.doctype.number_card.number_card.get_result",
				args: {
					doc: this.card_doc,
					filters: this.filters,
				},
				get_number: (res) => this.get_number_for_doctype_card(res),
			},
		};
		return settings_map[type];
	}

	get_filters() {
		return frappe.dashboard_utils.get_all_filters(this.card_doc);
	}

	async render_card() {
		// The control the keyboard sits on is remembered by selector before the action area is
		// rebuilt and re-matched in the rebuilt one (PR Description decision RD-12).
		this.pending_focus_control = this.pending_focus_control || this.get_focused_control();
		this.prepare_actions();
		this.restore_rebuilt_control_focus();
		this.set_title();
		this.card_doc?.background_color &&
			this.widget.css("background-color", this.card_doc.background_color);
		this.set_loading_state();

		if (!this.card_doc.type) {
			this.card_doc.type = "Document Type";
		}

		this.settings = this.get_settings(this.card_doc.type);
		await this.get_data();

		this.render_number();
		this.render_stats();
		this.update_tile_operability();
	}

	set_loading_state() {
		$(this.body).html(`<div class="number-card-loading text-muted">
			${__("Loading...")}
		</div>`);
	}

	async get_data() {
		this.data = await frappe.xcall(this.settings.method, this.settings.args);
		return this.settings.get_number(this.data);
	}

	get_number_for_custom_card(res) {
		if (typeof res === "object") {
			this.number = res.value;
			this.set_formatted_number(res);
		} else {
			this.formatted_number = res;
		}
	}

	get_number_for_doctype_card(res) {
		this.number = res;
		if (this.card_doc.function !== "Count") {
			return frappe.model.with_doctype(this.card_doc.document_type, () => {
				const based_on_df = frappe.meta.get_docfield(
					this.card_doc.document_type,
					this.card_doc.aggregate_function_based_on
				);
				this.set_formatted_number(based_on_df);
			});
		} else {
			this.formatted_number = res;
		}
	}

	get_number_for_report_card(res) {
		const field = this.card_doc.report_field;
		const vals = res.result.reduce((acc, col) => {
			col[field] && acc.push(col[field]);
			return acc;
		}, []);
		const col = res.columns.find((col) => col.fieldname == field);
		this.number = frappe.report_utils.get_result_of_fn(this.card_doc.report_function, vals);
		this.set_formatted_number(col, this._generate_common_doc(res.result));
	}

	set_formatted_number(df, doc) {
		if (this.number === null) {
			this.formatted_number = __("N/A", null, "Number not available");
			return;
		}

		const default_country = frappe.sys_defaults.country;

		let number_parts;

		// Use full number if the checkbox is enabled
		if (this.card_doc.show_full_number) {
			number_parts = [this.number.toString(), ""];
		} else {
			const shortened_number = frappe.utils.shorten_number(this.number, default_country, 5);
			number_parts = shortened_number.split(" ");
		}
		const symbol = number_parts[1] || "";
		// done to add multicurrency support in number card
		if (this.card_doc.currency) {
			this.formatted_number =
				format_currency(parseFloat(number_parts[0]), this.card_doc.currency) +
				(symbol ? " " + symbol : "");
			return;
		}

		number_parts[0] = window.convert_old_to_new_number_format(number_parts[0]);
		const formatted_number = frappe.format(number_parts[0], df, null, doc);
		this.formatted_number =
			($(formatted_number).text() || formatted_number) + (symbol ? " " + symbol : "");
	}

	_generate_common_doc(rows) {
		if (!rows || !rows.length) return {};
		// init with first doc, for each other doc if values are common then keep else discard
		// Whatever is left should be same in all objects
		const common_doc = Object.assign({}, rows[0]);
		rows.forEach((row) => {
			if (Array.isArray(row)) return; // totals row

			for (const [key, value] of Object.entries(common_doc)) {
				if (value !== row[key]) {
					delete common_doc[key];
				}
			}
		});
		return common_doc;
	}

	render_number() {
		const style_attr = this.card_doc.color ? `style="color: ${this.card_doc.color};"` : "";

		$(this.body).html(`<div class="widget-content">
			<div class="number" ${style_attr}>${this.formatted_number}</div>
			</div>`);
	}

	render_stats() {
		if (this.card_doc.type !== "Document Type" || !this.card_doc.show_percentage_stats) {
			return;
		}

		let caret_html = "";
		let color_class = "";

		return this.get_percentage_stats().then(() => {
			if (this.percentage_stat == 0 || this.percentage_stat == undefined) {
				color_class = "grey-stat";
			} else if (this.percentage_stat > 0) {
				caret_html = `<span class="indicator-pill-round green">
						${frappe.utils.icon("arrow-up-right", "xs")}
					</span>`;
				color_class = "green-stat";
			} else {
				caret_html = `<span class="indicator-pill-round red">
						${frappe.utils.icon("arrow-down-right", "xs")}
					</span>`;
				color_class = "red-stat";
			}

			const stats_qualifier_map = {
				Daily: __("since yesterday"),
				Weekly: __("since last week"),
				Monthly: __("since last month"),
				Yearly: __("since last year"),
			};
			const stats_qualifier = stats_qualifier_map[this.card_doc.stats_time_interval];

			let stat = (() => {
				if (this.percentage_stat == undefined) return NaN;
				const parts = this.percentage_stat.split(" ");
				const symbol = parts[1] || "";
				return Math.abs(parts[0]) + " " + symbol;
			})();

			// don't show stats if not valid number - skip showing `NaN %` in card
			if (isNaN(stat)) return;

			$(this.body).find(".widget-content").append(`<div class="card-stats ${color_class}">
				<span class="percentage-stat-area">
					${caret_html} ${stat} % ${stats_qualifier}
				</span>
			</div>`);
		});
	}

	get_percentage_stats() {
		return frappe
			.xcall("frappe.desk.doctype.number_card.number_card.get_percentage_difference", {
				doc: this.card_doc,
				filters: this.filters,
				result: this.number,
			})
			.then((res) => {
				if (res !== undefined) {
					this.percentage_stat = frappe.utils.shorten_number(res);
				}
			});
	}

	prepare_actions() {
		if (this.in_customize_mode) return;

		let actions = [
			{
				label: __("Refresh"),
				action: "action-refresh",
				handler: () => {
					// The rebuild this command triggers returns the keyboard to the rebuilt
					// card actions toggle (PR Description decision RD-12).
					this.pending_focus_control = ".card-menu";
					this.render_card();
				},
			},
			{
				label: __("Edit"),
				action: "action-edit",
				handler: () => {
					let number_card = this.number_card_name || this.name;
					frappe.dashboard_utils.suppress_menu_focus_restore();
					frappe.set_route("Form", "Number Card", number_card);
				},
			},
		];

		this.set_card_actions(actions);
	}

	set_card_actions(actions) {
		this.card_actions = $(`<div class="card-actions dropdown pull-right">
				<button type="button" class="btn btn-xs card-menu" data-toggle="dropdown"
					tabindex="0" aria-haspopup="true" aria-expanded="false"
					aria-label="${__("Card Actions")}" title="${__("Card Actions")}">
				...
				</button>
				<ul class="dropdown-menu" role="menu" style="max-height: 300px; overflow-y: auto;">
					${actions
						.map(
							(action) =>
								`<li role="none">
									<a class="dropdown-item" role="menuitem" tabindex="-1"
										data-action="${action.action}">${action.label}</a>
								</li>`
						)
						.join("")}
				</ul>
			</div>`);

		this.card_actions.find("a[data-action]").each((i, o) => {
			const action = o.dataset.action;
			$(o).click(actions.find((a) => a.action === action));
		});

		frappe.dashboard_utils.make_dropdown_keyboard_operable(this.card_actions);

		this.action_area.html(this.card_actions);
	}

	/**
	 * True while the keyboard sits on one of this widget's action-area controls.
	 *
	 * See PR Description decision RD-12.
	 */
	action_area_holds_focus() {
		const focused = document.activeElement;
		const area = this.action_area && this.action_area[0];

		return Boolean(focused && area && area.contains(focused));
	}

	/**
	 * The selector of the control in this widget's action area that holds the keyboard - the
	 * card actions toggle, the one control that area renders - or null while the keyboard sits
	 * anywhere else. `restore_rebuilt_control_focus()` matches the selector again in the
	 * rebuilt action area.
	 *
	 * See PR Description decision RD-12.
	 */
	get_focused_control() {
		return this.action_area_holds_focus() ? ".card-menu" : null;
	}

	/**
	 * Focuses the control `selector` matches in this widget's action area. An empty selector,
	 * and a selector the area holds no match for - the card actions toggle of a card in
	 * customize mode, which renders no menu - leave focus untouched.
	 *
	 * @param {string} [selector] CSS selector of the control, e.g. `".card-menu"`.
	 */
	focus_control(selector) {
		const area = this.action_area;

		if (!selector || !area) {
			return;
		}

		const $control = area.find(selector).first();
		$control.length && $control.trigger("focus");
	}

	/**
	 * Returns the keyboard to the control recorded in `pending_focus_control` once this
	 * widget's action area has been rebuilt, and clears the record, so a later render restores
	 * nothing of its own accord.
	 *
	 * Focus that the rebuild's command placed on a connected element outside this widget - a
	 * dialog, another widget, a new route - is left where it was put. Focus on `body`, on the
	 * document element, on an element the rebuild detached, or nowhere at all counts as
	 * unplaced and is returned to the recorded control.
	 *
	 * See PR Description decisions RD-11 and RD-12.
	 */
	restore_rebuilt_control_focus() {
		const selector = this.pending_focus_control;
		this.pending_focus_control = null;

		if (!selector) {
			return;
		}

		const focused = document.activeElement;
		const widget = this.widget && this.widget[0];
		const placed_outside_widget = Boolean(
			focused &&
				focused !== document.body &&
				focused !== document.documentElement &&
				focused.isConnected &&
				widget &&
				!widget.contains(focused)
		);

		if (placed_outside_widget) {
			return;
		}

		this.focus_control(selector);
	}
}
