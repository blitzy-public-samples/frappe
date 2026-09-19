frappe.provide("frappe.dashboards.chart_sources");

frappe.dashboards.chart_sources["ToDo Top Owners"] = {
	method: "frappe.desk.dashboard_chart_source.todo_top_owners.todo_top_owners.get",
	filters: null,
};
