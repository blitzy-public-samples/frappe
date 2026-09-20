# Copyright (c) 2026, Frappe Technologies and contributors
# License: MIT. See LICENSE

from datetime import date, datetime, time
from typing import Any

import frappe
from frappe import _
from frappe.desk.doctype.dashboard_chart.dashboard_chart import get_result
from frappe.utils import cint, get_datetime, getdate, now_datetime
from frappe.utils.dashboard import cache_source
from frappe.utils.data import format_date
from frappe.utils.dateutils import get_from_date_from_timespan, get_period, get_period_beginning

SOURCE_NAME = "ToDo Created vs Completed"
DEFAULT_TIMESPAN = "Last Week"
DEFAULT_TIME_INTERVAL = "Daily"
MAX_PERIODS = 10000
DATE_STRING_LENGTH = 10
WINDOW_FIELDS = ["timespan", "time_interval", "from_date", "to_date"]
CHART_FIELDS = ["source", *WINDOW_FIELDS]
PERIOD_LENGTH_IN_DAYS = {
	"Daily": 1,
	"Weekly": 7,
	"Monthly": 28,
	"Quarterly": 90,
	"Yearly": 365,
}


@frappe.whitelist(methods=["GET", "POST"])
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
	as a JSON object or a dict. The response holds one label per period of the resolved
	window and the datasets "Created" (counted on `creation`) and "Completed" (counted on
	`modified` of ToDos whose `status` is "Closed"), zero-filled for periods without
	activity.

	Both arguments are validated before the chart is loaded: a `chart` payload that is not
	a JSON object raises `frappe.ValidationError`, and so does a request that names no
	chart at all while asking for the stored result. A `chart_name` that does not name a
	Dashboard Chart whose `source` is this source raises `frappe.DoesNotExistError`, and
	the named chart is neither read further nor stamped.

	The method answers GET and POST; every other HTTP verb is refused by the framework.
	"""
	chart = _parse_chart(chart)

	if not no_cache and not chart_name and chart is None:
		frappe.throw(
			_("Either Chart Name or Chart is required"),
			title=_("Invalid Chart Request"),
		)

	return _get_chart_data(
		chart_name=chart_name,
		chart=chart,
		no_cache=_skips_shared_cache(no_cache, refresh),
		filters=filters,
		from_date=from_date,
		to_date=to_date,
		timespan=timespan,
		time_interval=time_interval,
		heatmap_year=heatmap_year,
		refresh=refresh,
	)


@cache_source
def _get_chart_data(
	chart_name: str | None = None,
	chart: dict[str, Any] | None = None,
	no_cache: bool | int | None = None,
	filters: str | list | dict[str, Any] | None = None,
	from_date: str | datetime | None = None,
	to_date: str | datetime | None = None,
	timespan: str | None = None,
	time_interval: str | None = None,
	heatmap_year: str | int | None = None,
	refresh: bool | int | None = None,
) -> dict[str, Any]:
	"""Return the two trend datasets for the window the given arguments resolve to.

	`cache_source` computes this result for every request and records the chart's
	`last_synced_on` for a request that asks for a refresh, on which path it calls this
	function with `chart_name` but without `chart`. The stored chart data is never read
	for this source.
	"""
	chart = _load_window_fields(chart_name, chart)

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


def _parse_chart(chart: str | dict[str, Any] | None) -> frappe._dict | None:
	"""Return the given chart payload as a dict, or None when no payload was given.

	A payload that is not parsable JSON, or that parses to anything other than an object,
	raises `frappe.ValidationError`.
	"""
	if chart is None or chart == "":
		return None

	if isinstance(chart, str):
		try:
			chart = frappe.parse_json(chart)
		except (TypeError, ValueError):
			frappe.throw(_("Chart is not valid JSON"), title=_("Invalid Chart Request"))

	if not isinstance(chart, dict):
		frappe.throw(_("Chart must be a JSON object"), title=_("Invalid Chart Request"))

	return frappe._dict(chart)


def _skips_shared_cache(no_cache: bool | int | None, refresh: bool | int | None) -> bool:
	"""Return whether `cache_source` must compute the result instead of reading it.

	Every request of this source is computed: one that asks for a refresh is computed by
	`cache_source` itself, and every other one is computed directly. The chart data stored
	under the chart's cache key is therefore never served by this source.
	"""
	return bool(no_cache) or not cint(refresh)


def _load_window_fields(chart_name: str | None, chart: dict[str, Any] | None) -> Any:
	"""Return the window fields the request resolves its window from.

	With `chart_name` the saved chart's `source`, `timespan`, `time_interval`, `from_date`
	and `to_date` are read in one query; otherwise the given payload is returned as a
	dict. A `chart_name` that names no Dashboard Chart, or one whose `source` is not this
	source, raises `frappe.DoesNotExistError`.
	"""
	if not chart_name:
		return frappe._dict(chart or {})

	window = frappe.db.get_value("Dashboard Chart", chart_name, CHART_FIELDS, as_dict=True)

	if not window or window.source != SOURCE_NAME:
		frappe.throw(
			_("Dashboard Chart {0} not found").format(chart_name),
			frappe.DoesNotExistError,
		)

	return window


def _resolve_window(
	chart: Any,
	timespan: str,
	timegrain: str,
	from_date: str | datetime | None,
	to_date: str | datetime | None,
) -> tuple[date, datetime]:
	"""Return the inclusive window bounds for the given timespan and time interval.

	For the timespan "Select Date Range" the bounds come from the given `from_date` and
	`to_date`, falling back to the chart's own date fields; a bound that names a day
	without a time of day spans that whole day, so activity on the last day of the range
	is counted. Every other timespan ends at the current datetime and begins at the start
	of the time grain that contains the from-date calculated for that timespan. The lower
	bound is a date, the upper bound a datetime.

	`timegrain` must be a key of `PERIOD_LENGTH_IN_DAYS` and `timespan` an option of the
	Dashboard Chart field `timespan`, each given bound must be a valid date, the lower
	bound must not be after the upper bound, and the window must hold at most
	`MAX_PERIODS` periods of `timegrain`; anything else raises `frappe.ValidationError`
	before a query runs.
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
		from_date = _window_bound(from_date or chart.from_date, _("From Date"))
		to_date = _window_bound(to_date or chart.to_date, _("To Date"), end_of_day=True)
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


def _window_bound(value: Any, label: str, end_of_day: bool = False) -> datetime:
	"""Return the given window bound as a datetime.

	With `end_of_day`, a bound that names a day without a time of day is returned as the
	last microsecond of that day. A bound that is not a valid date raises
	`frappe.ValidationError` naming `label`.
	"""
	try:
		bound = get_datetime(value)
	except (TypeError, ValueError, OverflowError):
		bound = None

	if not isinstance(bound, datetime):
		frappe.throw(
			_("{0} is not a valid date").format(label),
			title=_("Invalid Chart Window"),
		)

	if end_of_day and _is_date_only(value):
		return datetime.combine(getdate(bound), time.max)

	return bound


def _is_date_only(value: Any) -> bool:
	"""Return whether the given window bound names a day without a time of day."""
	if isinstance(value, datetime):
		return False

	if isinstance(value, date):
		return True

	return isinstance(value, str) and len(value.strip()) <= DATE_STRING_LENGTH


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
