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

DEFAULT_TIMESPAN = "Last Week"
DEFAULT_TIME_INTERVAL = "Daily"
MAX_PERIODS = 1000
MAX_AGGREGATE_ROWS = 100000
PERIOD_LENGTH_IN_DAYS = {
	"Daily": 1,
	"Weekly": 7,
	"Monthly": 28,
	"Quarterly": 90,
	"Yearly": 365,
}


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

	timespan = timespan or chart.timespan or DEFAULT_TIMESPAN
	timegrain = time_interval or chart.time_interval or DEFAULT_TIME_INTERVAL

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
	the current datetime and begins at the start of the time grain that contains the
	from-date calculated for that timespan. The lower bound is a date, the upper bound a
	datetime.

	`timegrain` must be a key of `PERIOD_LENGTH_IN_DAYS` and `timespan` an option of the
	Dashboard Chart field `timespan`, the lower bound must not be after the upper bound,
	and the window must hold at most `MAX_PERIODS` periods of `timegrain`; anything else
	raises `frappe.ValidationError` before a query runs.
	"""
	if timegrain not in PERIOD_LENGTH_IN_DAYS:
		frappe.throw(
			_("Time Interval must be one of: {0}").format(", ".join(PERIOD_LENGTH_IN_DAYS)),
			title=_("Invalid Chart Window"),
		)

	timespans = frappe.get_meta("Dashboard Chart").get_field("timespan").options.split("\n")

	if timespan not in timespans:
		frappe.throw(
			_("Timespan must be one of: {0}").format(", ".join(timespans)),
			title=_("Invalid Chart Window"),
		)

	if timespan == "Select Date Range":
		from_date = get_datetime(from_date) if from_date else get_datetime(chart.from_date)
		to_date = get_datetime(to_date) if to_date else get_datetime(chart.to_date)
	else:
		to_date = now_datetime()
		from_date = get_period_beginning(get_from_date_from_timespan(to_date, timespan), timegrain)

	from_date, to_date = getdate(from_date), get_datetime(to_date)
	last_day = getdate(to_date)

	if from_date > last_day:
		frappe.throw(
			_("From Date {0} must not be after To Date {1}").format(from_date, last_day),
			title=_("Invalid Chart Window"),
		)

	period_length = PERIOD_LENGTH_IN_DAYS[timegrain]
	periods = ((last_day - from_date).days + period_length) // period_length

	if periods > MAX_PERIODS:
		frappe.throw(
			_("A window of {0} {1} periods exceeds the limit of {2}").format(
				periods, _(timegrain), MAX_PERIODS
			),
			title=_("Invalid Chart Window"),
		)

	return from_date, to_date


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

	A window whose readable ToDos exceed `MAX_AGGREGATE_ROWS` raises
	`frappe.ValidationError` before the grouped rows are fetched.
	"""
	filters = [
		*extra_filters,
		["ToDo", datefield, ">=", from_date.strftime("%Y-%m-%d")],
		["ToDo", datefield, "<=", to_date],
	]
	readable_rows = frappe.get_list("ToDo", fields=[{"COUNT": "*"}], filters=filters, as_list=True)[0][0]

	if readable_rows > MAX_AGGREGATE_ROWS:
		frappe.throw(
			_("The window holds {0} ToDos, more than the limit of {1}").format(
				readable_rows, MAX_AGGREGATE_ROWS
			),
			title=_("Invalid Chart Window"),
		)

	rows = frappe.get_list(
		"ToDo",
		fields=[datefield, {"SUM": "1"}, {"COUNT": "*"}],
		filters=filters,
		group_by=datefield,
		order_by=datefield,
		as_list=True,
	)

	return get_result(rows, timegrain, from_date, to_date, "Count")
