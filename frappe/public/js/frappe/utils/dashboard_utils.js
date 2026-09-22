frappe.dashboard_utils = {
	/**
	 * Renders one dropdown per entry of `filters` into a group element appended - or, with
	 * `append` set, prepended - to `container`. The group lays its dropdowns out left to right
	 * in the order they are painted, so the keyboard reaches them in that order inside a
	 * widget control row that paints its own children right to left, and wraps them onto
	 * further rows where the row is too narrow to hold them side by side.
	 *
	 * See PR Description decisions RD-13 and RD-15.
	 *
	 * @param {Array} filters One object per dropdown: `label`, `options`, `action` and the
	 *   optional `icon`, `class` and `fieldnames`.
	 * @param {string} button_class Class every dropdown carries, e.g. `"chart-actions"`.
	 * @param {Object} container jQuery object wrapping the element the group is inserted into.
	 * @param {boolean|number} append Truthy to prepend the group to `container`.
	 */
	render_chart_filters: function (filters, button_class, container, append) {
		if (!filters || !filters.length) return;

		const $filter_group = $(`<div class="chart-filter-group"></div>`).css({
			display: "flex",
			"flex-wrap": "wrap",
			"align-items": "center",
			gap: "5px",
			"min-width": "0",
		});

		if (append) {
			$filter_group.prependTo(container);
		} else $filter_group.appendTo(container);

		filters.forEach((filter) => {
			let icon_html = "",
				filter_class = "";

			if (filter.icon) {
				icon_html = frappe.utils.icon(filter.icon);
			}

			if (filter.class) {
				filter_class = filter.class;
			}

			let chart_filter_html = `<div class="${button_class} ${filter_class} btn-group dropdown pull-right">
					<button class="btn btn-secondary btn-xs chart-filter-toggle" data-toggle="dropdown"
						aria-haspopup="true" aria-expanded="false">
						${icon_html}
						<span class="filter-label">${__(filter.label)}</span>
						${frappe.utils.icon("chevrons-up-down", "xs")}
					</button>`;
			let options_html;

			// The option whose text matches this control's label is rendered as the checked
			// option (PR Description decision RD-3).
			const applied_label = filter.label == null ? "" : String(__(filter.label));
			const is_applied = (option) =>
				applied_label !== "" &&
				[String(option), String(__(option))].includes(applied_label);
			const option_class = (option) =>
				is_applied(option) ? "dropdown-item active" : "dropdown-item";
			const option_checked = (option) => (is_applied(option) ? "true" : "false");

			if (filter.fieldnames) {
				options_html = filter.options
					.map(
						(option, i) =>
							`<li role="none">
						<a class="${option_class(option)}" role="menuitemradio"
							aria-checked="${option_checked(option)}" tabindex="-1"
							data-fieldname="${filter.fieldnames[i]}"
							data-option="${encodeURIComponent(option)}">${__(option)}</a>
					</li>`
					)
					.join("");
			} else {
				options_html = filter.options
					.map(
						(option) =>
							`<li role="none"><a class="${option_class(
								option
							)}" role="menuitemradio" aria-checked="${option_checked(
								option
							)}" tabindex="-1"
								data-option="${encodeURIComponent(option)}">${__(option)}</a></li>`
					)
					.join("");
			}

			let dropdown_html =
				chart_filter_html +
				`<ul class="dropdown-menu" role="menu">${options_html}</ul></div>`;
			let $chart_filter = $(dropdown_html);

			// Each dropdown is inserted at the start of the group, which reverses the order
			// the caller passes them in (PR Description decision RD-13).
			$chart_filter.prependTo($filter_group);

			$chart_filter.find(".dropdown-menu").on("click", "li a", (e) => {
				let $el = $(e.currentTarget);
				let fieldname;
				if ($el.attr("data-fieldname")) {
					fieldname = $el.attr("data-fieldname");
				}

				let selected_item = decodeURIComponent($el.data("option"));
				$el.parents(`.${button_class}`).find(".filter-label").html(__(selected_item));
				filter.action(selected_item, fieldname);

				// keep focus where the action moved it when it leaves this dropdown
				const focused = document.activeElement;
				const focus_moved =
					focused &&
					focused !== document.body &&
					focused !== document.documentElement &&
					!$chart_filter[0].contains(focused);

				if (!focus_moved) {
					$chart_filter.find('[data-toggle="dropdown"]').trigger("focus");
				}
			});

			this.make_dropdown_keyboard_operable($chart_filter);
		});
	},

	// Selector for the focusable options of a widget menu, covering command items
	// (`menuitem`) and single-selection options (`menuitemradio`).
	MENU_ITEM_SELECTOR: '[role="menuitem"], [role="menuitemradio"]',

	// Set while an activated menu command routes away from the page its menu is on; read and
	// cleared by the dropdown close that follows (PR Description decision RD-5).
	menu_focus_restore_suppressed: false,

	/**
	 * Suppresses the focus restoration of the widget-menu close that follows this call.
	 *
	 * Call it from the click handler of a menu command, immediately before the
	 * `frappe.set_route(...)` that leaves the page: the next `hidden.bs.dropdown` of a
	 * keyboard-operable dropdown then leaves focus where the command put it. The suppression
	 * is consumed by that close and, if no menu closes, dropped at the end of the current
	 * task, so it never applies to a later close.
	 *
	 * See PR Description decision RD-5.
	 */
	suppress_menu_focus_restore() {
		frappe.dashboard_utils.menu_focus_restore_suppressed = true;
		setTimeout(() => {
			frappe.dashboard_utils.menu_focus_restore_suppressed = false;
		}, 0);
	},

	// Returns whether focus restoration is suppressed for the close being handled, and clears
	// the suppression.
	consume_menu_focus_restore_suppression() {
		const suppressed = frappe.dashboard_utils.menu_focus_restore_suppressed;
		frappe.dashboard_utils.menu_focus_restore_suppressed = false;
		return suppressed;
	},

	/**
	 * Makes one widget menu (chart actions, card actions, timespan / interval / heatmap-year
	 * dropdown) fully operable from the keyboard, and returns focus to its toggle after a close
	 * that left focus unplaced.
	 *
	 * Behaviour installed on `$dropdown` (a Bootstrap `.dropdown` container holding one
	 * `[data-toggle="dropdown"]` toggle and one `.dropdown-menu`):
	 *  - Enter, Space and ArrowDown on the toggle open the menu and focus its first option;
	 *    ArrowUp opens it and focuses the last option.
	 *  - ArrowDown / ArrowUp move between options and wrap around; Home and End jump to the
	 *    first and last option.
	 *  - Enter and Space activate the focused option.
	 *  - Escape closes an open menu and keeps the key from reaching the document; with the menu
	 *    closed the key is left to the document's own handlers.
	 *  - Tab and Shift+Tab close the menu and let focus continue along the document's own tab
	 *    order.
	 *  - On `hidden.bs.dropdown` — which covers Escape, an outside click, option activation and
	 *    a programmatic close — focus returns to the toggle if the toggle is still in the
	 *    document and focus is on `body` or the document element, inside the menu that just
	 *    closed, or nowhere. Two closes are exempt: one performed by Tab or Shift+Tab, and
	 *    one whose command marked itself as navigating away with
	 *    `frappe.dashboard_utils.suppress_menu_focus_restore()`. Focus that an action moved
	 *    elsewhere (a dialog, a new route) stays where it was put.
	 *  - The menu is given `role="menu"` and is labelled by its toggle through `aria-labelledby`.
	 *
	 * Usage: call once per rendered dropdown, e.g.
	 * `frappe.dashboard_utils.make_dropdown_keyboard_operable(this.chart_actions)`.
	 *
	 * @param {Object} $dropdown jQuery object wrapping the `.dropdown` container.
	 */
	make_dropdown_keyboard_operable($dropdown) {
		const $toggle = $dropdown.find('[data-toggle="dropdown"]').first();
		const $menu = $dropdown.find(".dropdown-menu").first();

		if (!$toggle.length || !$menu.length) return;
		// One binding per rendered dropdown (PR Description decision RD-8).
		if ($dropdown.data("keyboard-operable")) return;
		$dropdown.data("keyboard-operable", true);

		this.label_dropdown_menu($toggle, $menu);

		const items = () => $menu.find(this.MENU_ITEM_SELECTOR).filter(":visible").toArray();
		const is_open = () => $dropdown.hasClass("show");
		// The menu is opened and closed by triggering a click on its toggle (PR Description
		// decision RD-7).
		const open_menu = () => !is_open() && $toggle.trigger("click");
		const close_menu = () => is_open() && $toggle.trigger("click");

		const focus_item = (index) => {
			const list = items();
			if (!list.length) return;
			list[((index % list.length) + list.length) % list.length].focus();
		};

		// True only while a Tab keypress closes the menu; the close handler leaves focus
		// untouched while it is set (PR Description decision RD-5).
		let leaving_by_tab = false;

		$toggle.on("keydown", (e) => {
			if (e.key === "Tab") {
				if (!is_open()) return;
				leaving_by_tab = true;
				close_menu();
				leaving_by_tab = false;
				return;
			}

			if (!["Enter", " ", "ArrowDown", "ArrowUp", "Escape"].includes(e.key)) return;

			// Escape is this handler's key only while there is an open menu to close; with the
			// menu closed it is left to the document (PR Description decision RD-4).
			if (e.key === "Escape" && !is_open()) return;

			e.preventDefault();
			e.stopPropagation();

			if (e.key === "Escape") {
				close_menu();
				return;
			}

			open_menu();
			focus_item(e.key === "ArrowUp" ? -1 : 0);
		});

		$menu.on("keydown", this.MENU_ITEM_SELECTOR, (e) => {
			const $item = $(e.currentTarget);

			if (e.key === "Tab") {
				leaving_by_tab = true;
				close_menu();
				leaving_by_tab = false;
				return;
			}

			if (!["Enter", " ", "ArrowDown", "ArrowUp", "Home", "End", "Escape"].includes(e.key)) {
				return;
			}

			e.preventDefault();
			e.stopPropagation();

			const list = items();
			const index = list.indexOf($item[0]);

			if (e.key === "ArrowDown") {
				focus_item(index + 1);
			} else if (e.key === "ArrowUp") {
				focus_item(index - 1);
			} else if (e.key === "Home") {
				focus_item(0);
			} else if (e.key === "End") {
				focus_item(-1);
			} else if (e.key === "Escape") {
				close_menu();
			} else {
				$item.trigger("click");
			}
		});

		// Keeps the selected option of a single-selection menu marked for assistive
		// technology after a mouse or keyboard activation.
		$menu.on("click", '[role="menuitemradio"]', (e) => {
			this.mark_selected_dropdown_option($menu, $(e.currentTarget));
		});

		$dropdown.on("hidden.bs.dropdown", () => {
			const focus_restore_suppressed = this.consume_menu_focus_restore_suppression();
			if (focus_restore_suppressed || leaving_by_tab) return;

			const toggle = $toggle[0];
			if (!toggle.isConnected) return;

			// Focus counts as unplaced when it is on `body` or the document element, inside
			// the menu that just closed, or nowhere (PR Description decisions RD-5, RD-11).
			const focused = document.activeElement;
			if (
				!focused ||
				focused === document.body ||
				focused === document.documentElement ||
				$menu[0].contains(focused)
			) {
				toggle.focus();
			}
		});
	},

	// Gives the menu `role="menu"` and names it after its toggle, assigning the toggle an id
	// when it has none.
	label_dropdown_menu($toggle, $menu) {
		if (!$menu.attr("role")) {
			$menu.attr("role", "menu");
		}

		$menu.attr("aria-labelledby", frappe.dom.set_unique_id($toggle[0]));
	},

	// Marks `$selected` as the applied option of a single-selection menu and unmarks the rest,
	// both programmatically (`aria-checked`) and visually (`.active`).
	mark_selected_dropdown_option($menu, $selected) {
		const $options = $menu.find('[role="menuitemradio"]');

		$options.attr("aria-checked", "false").removeClass("active");
		$selected && $selected.length && $selected.attr("aria-checked", "true").addClass("active");
	},

	get_filters_for_chart_type: function (chart) {
		if (chart.chart_type === "Custom" && chart.source) {
			const method =
				"frappe.desk.doctype.dashboard_chart_source.dashboard_chart_source.get_config";
			return frappe.xcall(method, { name: chart.source }).then((config) => {
				frappe.dom.eval(config);
				return frappe.dashboards.chart_sources[chart.source].filters;
			});
		} else if (chart.chart_type === "Report" && chart.report_name) {
			return frappe.report_utils.get_report_filters(chart.report_name).then((filters) => {
				return filters;
			});
		} else {
			return Promise.resolve();
		}
	},

	get_dashboard_settings() {
		return frappe.db
			.get_list("Dashboard Settings", {
				filters: {
					name: frappe.session.user,
				},
				fields: ["*"],
			})
			.then((settings) => {
				if (!settings.length) {
					return this.create_dashboard_settings().then((settings) => {
						return settings;
					});
				} else {
					return settings[0];
				}
			});
	},

	create_dashboard_settings() {
		return frappe
			.xcall(
				"frappe.desk.doctype.dashboard_settings.dashboard_settings.create_dashboard_settings",
				{
					user: frappe.session.user,
				}
			)
			.then((settings) => {
				return settings;
			});
	},

	get_years_since_creation(creation) {
		//Get years since user account created
		let creation_year = this.get_year(creation);
		let current_year = this.get_year(frappe.datetime.now_date());
		let years_list = [];
		for (var year = current_year; year >= creation_year; year--) {
			years_list.push(year);
		}
		return years_list;
	},

	get_year(date_str) {
		return date_str.substring(0, date_str.indexOf("-"));
	},

	remove_common_static_filter_values(static_filters, dynamic_filters) {
		if (dynamic_filters) {
			if (Array.isArray(static_filters)) {
				static_filters = static_filters.filter((static_filter) => {
					for (let dynamic_filter of dynamic_filters) {
						if (
							static_filter[0] == dynamic_filter[0] &&
							static_filter[1] == dynamic_filter[1]
						) {
							return false;
						}
					}
					return true;
				});
			} else {
				for (let key of Object.keys(dynamic_filters)) {
					delete static_filters[key];
				}
			}
		}

		return static_filters;
	},

	get_fields_for_dynamic_filter_dialog(is_document_type, filters, dynamic_filters) {
		let fields = [
			{
				fieldtype: "HTML",
				fieldname: "description",
				options: `<div>
						<p>${__("Set dynamic filter values in JavaScript for the required fields here.")}
						</p>
						<p>${__("For example:")}
							<code>frappe.defaults.get_user_default("Company")</code>
						</p>
					</div>`,
			},
		];

		if (is_document_type) {
			if (dynamic_filters) {
				filters = [...filters, ...dynamic_filters];
			}
			filters.forEach((f) => {
				for (let field of fields) {
					if (field.fieldname == f[0] + ":" + f[1]) {
						return;
					}
				}
				if (f[2] == "=") {
					fields.push({
						label: `${f[1]} (${f[0]})`,
						fieldname: f[0] + ":" + f[1],
						fieldtype: "Data",
					});
				}
			});
		} else {
			filters = { ...dynamic_filters, ...filters };
			for (let key of Object.keys(filters)) {
				fields.push({
					label: key,
					fieldname: key,
					fieldtype: "Data",
				});
			}
		}

		return fields;
	},

	// A filter value counts as unset when it is undefined, null, an empty or whitespace-only
	// string, or an array with no entries. 0, false and arrays with entries are set values.
	is_unset_filter_value(value) {
		if (value === undefined || value === null) {
			return true;
		}

		if (typeof value === "string") {
			return value.trim() === "";
		}

		if (Array.isArray(value)) {
			return value.length === 0;
		}

		return false;
	},

	// Evaluates the dynamic filters of a chart or card and merges them into its static filters.
	// A dynamic filter whose expression evaluates to an unset value is left out of the result:
	// the list-shaped row is omitted and the dict-shaped key is not written.
	get_all_filters(doc) {
		const filters = doc.filters_json ? JSON.parse(doc.filters_json) : null;
		const dynamic_filters = doc.dynamic_filters_json
			? JSON.parse(doc.dynamic_filters_json)
			: null;

		const has_dynamic_filters = Array.isArray(dynamic_filters)
			? dynamic_filters.length
			: dynamic_filters && Object.keys(dynamic_filters).length;

		if (!has_dynamic_filters) {
			return filters;
		}

		if (!Array.isArray(dynamic_filters)) {
			const evaluated_filters = {};

			Object.keys(dynamic_filters).forEach((key) => {
				let value;
				try {
					value = eval(dynamic_filters[key]);
				} catch (e) {
					frappe.throw(__("Invalid expression set in filter {0}", [key]));
				}

				if (!this.is_unset_filter_value(value)) {
					evaluated_filters[key] = value;
				}
			});

			return filters ? Object.assign({}, filters, evaluated_filters) : evaluated_filters;
		}

		const evaluated_filters = [];

		dynamic_filters.forEach((f) => {
			let value;
			try {
				value = eval(f[3]);
			} catch (e) {
				frappe.throw(__("Invalid expression set in filter {0} ({1})", [f[1], f[0]]));
			}

			if (!this.is_unset_filter_value(value)) {
				const evaluated_filter = [...f];
				evaluated_filter[3] = value;
				evaluated_filters.push(evaluated_filter);
			}
		});

		if (!filters) {
			return evaluated_filters;
		}

		if (Array.isArray(filters)) {
			return [...filters, ...evaluated_filters];
		}

		const merged_filters = Object.assign({}, filters);
		evaluated_filters.forEach((f) => {
			merged_filters[f[1]] = f[3];
		});

		return merged_filters;
	},
	get_dashboard_link_field() {
		let field = {
			label: __("Select Dashboard"),
			fieldtype: "Link",
			fieldname: "dashboard",
			options: "Dashboard",
		};

		if (!frappe.boot.developer_mode) {
			field.get_query = () => {
				return {
					filters: {
						is_standard: 0,
					},
				};
			};
		}

		return field;
	},

	get_add_to_dashboard_dialog(docname, doctype, method) {
		const field = this.get_dashboard_link_field();

		const dialog = new frappe.ui.Dialog({
			title: __("Add to Dashboard"),
			fields: [field],
			primary_action: (values) => {
				values.name = docname;
				values.set_standard = frappe.boot.developer_mode;
				return frappe.xcall(method, { args: values }).then(() => {
					let dashboard_route_html = `<a href = "/desk/dashboard/${values.dashboard}">${values.dashboard}</a>`;
					let message = __("{0} {1} added to Dashboard {2}", [
						doctype,
						values.name,
						dashboard_route_html,
					]);

					frappe.msgprint(message);
					dialog.hide();
				});
			},
		});

		return dialog;
	},
};
