import Widget from "./base_widget.js";

frappe.provide("frappe.utils");

export default class ShortcutWidget extends Widget {
	constructor(opts) {
		opts.shadow = true;
		super(opts);
	}

	get_config() {
		return {
			name: this.name,
			icon: this.icon,
			label: this.label,
			format: this.format,
			link_to: this.link_to,
			doc_view: this.doc_view,
			color: this.color,
			restrict_to_domain: this.restrict_to_domain,
			stats_filter: this.stats_filter,
			type: this.type,
			url: this.url,
			kanban_board: this.kanban_board,
		};
	}

	setup_events() {
		this.widget.click((e) => this.activate(e));

		// Enter or Space on the tile itself runs the same activation as a click
		// (PR Description decision RD-14). The namespaced binding is replaced, not added to,
		// on every render, and keys pressed on a control nested inside the tile are ignored.
		this.widget.off("keydown.shortcut").on("keydown.shortcut", (e) => {
			if (e.target !== this.widget[0]) return;
			if (this.in_customize_mode) return;
			if (!["Enter", " ", "Spacebar"].includes(e.key)) return;

			e.preventDefault();
			this.activate(e);
		});
	}

	/**
	 * Opens the shortcut's destination, and is the single activation path shared by a click on
	 * the tile and Enter or Space pressed on it: the quick entry dialog for a Document Type
	 * shortcut whose view is "New", the shortcut's URL in a new tab for a URL shortcut, or the
	 * route generated from the shortcut's target - with the shortcut's own filters applied as
	 * route options for a Document Type shortcut, and the route opened in a new tab when the
	 * activating event carries Ctrl or Cmd.
	 *
	 * Does nothing while the workspace is in customize mode.
	 *
	 * @param {Object} e - the click or keydown event that activated the tile
	 */
	activate(e) {
		if (this.in_customize_mode) return;

		if (this.type == "DocType" && this.doc_view == "New") {
			frappe.ui.form.make_quick_entry(
				this.link_to,
				// Callback to ensure no redirection after insert
				() => {}
			);
			return;
		}

		let route = frappe.utils.generate_route({
			route: this.route,
			name: this.link_to,
			type: this.type,
			is_query_report: this.is_query_report,
			doctype: this.ref_doctype,
			doc_view: this.doc_view,
			kanban_board: this.kanban_board,
			report_ref_doctype: this.report_ref_doctype,
		});

		let filters = frappe.utils.get_filter_from_json(this.stats_filter);
		if (this.type == "DocType" && filters) {
			frappe.route_options = filters;
		}

		if (e.ctrlKey || e.metaKey) {
			frappe.open_in_new_tab = true;
		}

		if (this.type == "URL") {
			window.open(this.url, "_blank");
			return;
		}

		frappe.set_route(route);
	}

	set_actions() {
		if (this.in_customize_mode) return;
		let icon_to_append = frappe.utils.icon("arrow-up-right", "xs", "", "", "ml-2");
		if (frappe.utils.is_rtl(frappe.boot.lang)) {
			icon_to_append = frappe.utils.icon("arrow-up-left", "xs", "", "", "ml-2");
		}
		$(icon_to_append).appendTo(this.action_area);

		this.widget.addClass("shortcut-widget-box");

		// Make it tabbable
		this.widget.attr({
			role: "link",
			tabindex: 0,
			"aria-label": this.label,
		});

		let filters = frappe.utils.process_filter_expression(this.stats_filter);

		if (
			this.type == "DocType" &&
			this.doc_view != "New" &&
			!frappe.boot.single_types.includes(this.link_to)
		) {
			frappe.db
				.count(this.link_to, {
					filters: filters || [],
				})
				.then((count) => this.set_count(count));
		}
	}

	set_count(count) {
		const get_label = () => {
			if (this.format) {
				return __(this.format).replace(/{}/g, count);
			}
			return count;
		};

		this.action_area.empty();
		const label = get_label();

		// TODO: (Workspace): Remove this once the color map is updated in the backend

		const COLOR_MAP = {
			Grey: "gray",
			Green: "green",
			Red: "red",
			Orange: "amber",
			Pink: "violet",
			Yellow: "amber",
			Blue: "blue",
			Cyan: "blue",
		};

		const color = this.color && count ? COLOR_MAP[this.color] || "gray" : "gray";
		frappe.ui.badge({ label: __(label), theme: color }).appendTo(this.action_area);

		$(frappe.utils.icon("arrow-up-right", "xs", "", "", "ml-2")).appendTo(this.action_area);
	}
}
