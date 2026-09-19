frappe.provide("frappe.dashboards.chart_sources");

frappe.dashboards.chart_sources["ToDo Created vs Completed"] = {
	method: "frappe.desk.dashboard_chart_source.todo_created_vs_completed.todo_created_vs_completed.get",
	filters: [],
};
