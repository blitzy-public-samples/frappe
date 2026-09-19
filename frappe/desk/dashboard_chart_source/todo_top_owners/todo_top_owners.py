# Copyright (c) 2026, Frappe Technologies and contributors
# License: MIT. See LICENSE

from datetime import datetime
from typing import Any

import frappe
from frappe import _
from frappe.utils.dashboard import cache_source

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
	"""Return each user id in `users` mapped to its full name, or to the id when no name resolves."""
	if not users:
		return {}

	full_names = dict(
		frappe.db.get_values("User", {"name": ("in", list(dict.fromkeys(users)))}, ["name", "full_name"])
		or []
	)

	return {user: full_names.get(user) or user for user in users}


def _owner_label(user: str) -> str:
	"""Return the full name of `user`, or the user id when no name resolves."""
	return _owner_labels([user])[user]


@frappe.whitelist()
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
	"""Return the chart payload of the top open ToDo owners, or None when there is none."""
	_validate_chart_identity(chart_name, chart)

	return _get_chart_data(
		chart_name=chart_name,
		chart=chart,
		no_cache=no_cache,
		filters=filters,
		from_date=from_date,
		to_date=to_date,
		timespan=timespan,
		time_interval=time_interval,
		heatmap_year=heatmap_year,
		refresh=refresh,
	)


def _validate_chart_identity(chart_name: str | None, chart: str | dict[str, Any] | None) -> None:
	"""Raise MandatoryError when no chart is supplied and ValidationError when `chart` is not an object."""
	if chart_name:
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
