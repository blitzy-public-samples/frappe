# Copyright (c) 2026, Frappe Technologies and contributors
# License: MIT. See LICENSE

from datetime import date, datetime
from typing import Any

import frappe
from frappe import _
from frappe.desk.doctype.dashboard_chart.dashboard_chart import get_result
from frappe.utils import get_datetime, getdate, now_datetime
from frappe.utils.dashboard import cache_source
from frappe.utils.data import format_date
from frappe.utils.dateutils import get_from_date_from_timespan, get_period, get_period_beginning


@frappe.whitelist()
@cache_source
def get(
	chart_name: str | None = None,
	chart: str | dict[str, Any] | None = None,
	no_cache: bool | int | None = None,
	filters: str | list | dict[str, Any] | None = None,
	from_date: str | datetime | None = None,
	to_date: str | datetime | None = None,
	timespan: str | None = None,
	time_interval: str | None = None,
	heatmap_year: str | int | None = None,
	refresh: bool | int | None = None,
) -> dict[str, Any]:
	"""Return created and completed ToDo counts per period as two chart datasets.

	`chart_name` loads a saved Dashboard Chart; `chart` accepts an unsaved chart payload
	as JSON or a dict. The response holds one label per period of the resolved window and
	the datasets "Created" (counted on `creation`) and "Completed" (counted on `modified`
	of ToDos whose `status` is "Closed"), zero-filled for periods without activity.
	"""
	if chart_name:
		chart = frappe.get_doc("Dashboard Chart", chart_name)
	else:
		chart = frappe._dict(frappe.parse_json(chart) or {})

	timespan = timespan or chart.timespan or "Last Week"
	timegrain = time_interval or chart.time_interval or "Daily"

	from_date, to_date = _resolve_window(chart, timespan, timegrain, from_date, to_date)

	created = _count_by_period("creation", [], from_date, to_date, timegrain)
	completed = _count_by_period(
		"modified", [["ToDo", "status", "=", "Closed"]], from_date, to_date, timegrain
	)

	return {
		"labels": [
			format_date(get_period(r[0], timegrain), parse_day_first=True)
			if timegrain in ("Daily", "Weekly")
			else get_period(r[0], timegrain)
			for r in created
		],
		"datasets": [
			{"name": _("Created"), "values": [r[1] for r in created]},
			{"name": _("Completed"), "values": [r[1] for r in completed]},
		],
	}


def _resolve_window(
	chart: Any,
	timespan: str,
	timegrain: str,
	from_date: str | datetime | None,
	to_date: str | datetime | None,
) -> tuple[date, datetime]:
	"""Return the inclusive window bounds for the given timespan and time interval.

	For the timespan "Select Date Range" the bounds come from the given `from_date` and
	`to_date`, falling back to the chart's own date fields. Every other timespan ends at
	the current datetime and begins at the start of the period that contains it. The
	lower bound is a date, the upper bound a datetime.
	"""
	if timespan == "Select Date Range":
		from_date = get_datetime(from_date) if from_date else get_datetime(chart.from_date)
		to_date = get_datetime(to_date) if to_date else get_datetime(chart.to_date)
	else:
		to_date = now_datetime()
		from_date = get_period_beginning(get_from_date_from_timespan(to_date, timespan), timegrain)

	return getdate(from_date), get_datetime(to_date)


def _count_by_period(
	datefield: str,
	extra_filters: list,
	from_date: date,
	to_date: datetime,
	timegrain: str,
) -> list[list]:
	"""Return zero-filled `[period_ending_date, count]` rows of ToDos for one date field.

	`extra_filters` is added to the window filters on `datefield`. Both window bounds are
	inclusive and the counts are scoped to the ToDos readable by the current user.
	"""
	rows = frappe.get_list(
		"ToDo",
		fields=[datefield, {"SUM": "1"}, {"COUNT": "*"}],
		filters=[
			*extra_filters,
			["ToDo", datefield, ">=", from_date.strftime("%Y-%m-%d")],
			["ToDo", datefield, "<=", to_date],
		],
		group_by=datefield,
		order_by=datefield,
		as_list=True,
	)

	return get_result(rows, timegrain, from_date, to_date, "Count")
