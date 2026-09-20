# Copyright (c) 2026, Frappe Technologies and contributors
# License: MIT. See LICENSE

from datetime import datetime
from typing import Any

import frappe
from frappe import _
from frappe.utils import cint, escape_html
from frappe.utils.dashboard import cache_source

SOURCE_NAME = "ToDo Top Owners"
TOP_N = 5


def get_top_owners(limit: int = TOP_N) -> list[dict[str, Any]]:
	"""Return the top `limit` users by open ToDo count, as rows of `name`, `count` and `label`."""
	rows = frappe.get_list(
		"ToDo",
		fields=["allocated_to as name", {"COUNT": "*", "as": "count"}],
		filters=[["ToDo", "status", "=", "Open"], ["ToDo", "allocated_to", "is", "set"]],
		group_by="allocated_to",
		order_by="count desc, allocated_to asc",
		limit=limit,
	)

	labels = _owner_labels([row.name for row in rows])

	for row in rows:
		row.label = labels[row.name]

	return rows


def _owner_labels(users: list[str]) -> dict[str, str]:
	"""Return each user id in `users` mapped to the HTML-escaped full name of that user.

	Names are read once per distinct user id. A user id whose full name does not resolve — an unknown,
	deleted or unnamed user — maps to the HTML-escaped user id itself.

	e.g. `_owner_labels(["a@example.com"])` -> `{'a@example.com': '&lt;b&gt;A&lt;/b&gt;'}` for the
	full name `<b>A</b>`.
	"""
	if not users:
		return {}

	full_names = {user: frappe.get_cached_value("User", user, "full_name") for user in dict.fromkeys(users)}

	return {user: escape_html(full_names[user] or user) for user in users}


def _owner_label(user: str) -> str:
	"""Return the HTML-escaped full name of `user`, or the escaped user id when no name resolves."""
	return _owner_labels([user])[user]


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
) -> dict[str, Any] | None:
	"""Return the chart payload of the top open ToDo owners, or None when there is none.

	A `chart_name` that does not name a Dashboard Chart whose `source` is this source
	raises `frappe.DoesNotExistError`, and the named chart is neither read further nor
	stamped. The method answers GET and POST; every other HTTP verb is refused by the
	framework.
	"""
	_validate_chart_identity(chart_name, chart)

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


def _validate_chart_identity(chart_name: str | None, chart: str | dict[str, Any] | None) -> None:
	"""Raise MandatoryError when no chart is supplied and ValidationError when `chart` is not an object.

	A `chart_name` is accepted only when it names a Dashboard Chart whose `source` is this
	source; any other name raises `frappe.DoesNotExistError`.
	"""
	if chart_name:
		if frappe.db.get_value("Dashboard Chart", chart_name, "source") != SOURCE_NAME:
			frappe.throw(
				_("Dashboard Chart {0} not found").format(chart_name),
				frappe.DoesNotExistError,
			)

		return

	if not chart:
		frappe.throw(
			_("Please specify the Dashboard Chart to load."),
			frappe.exceptions.MandatoryError,
			title=_("Chart Not Specified"),
		)

	if isinstance(chart, dict):
		return

	parsed = None

	if isinstance(chart, str):
		try:
			parsed = frappe.parse_json(chart)
		except ValueError:
			frappe.throw(
				_("The Dashboard Chart configuration is not valid JSON."),
				title=_("Invalid Dashboard Chart"),
			)

	if not isinstance(parsed, dict):
		frappe.throw(
			_("The Dashboard Chart configuration must be a JSON object."),
			title=_("Invalid Dashboard Chart"),
		)


def _skips_shared_cache(no_cache: bool | int | None, refresh: bool | int | None) -> bool:
	"""Return whether `cache_source` must compute the result instead of reading it.

	Every request of this source is computed: one that asks for a refresh is computed by
	`cache_source` itself, and every other one is computed directly. The chart data stored
	under the chart's cache key is therefore never served by this source.
	"""
	return bool(no_cache) or not cint(refresh)


@cache_source
def _get_chart_data(
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
) -> dict[str, Any] | None:
	"""Return the chart payload of the top open ToDo owners, or None when there is none."""
	owners = get_top_owners()

	if not owners:
		return None

	return {
		"labels": [owner.label for owner in owners],
		"datasets": [{"name": _("Open ToDos"), "values": [owner["count"] for owner in owners]}],
	}
