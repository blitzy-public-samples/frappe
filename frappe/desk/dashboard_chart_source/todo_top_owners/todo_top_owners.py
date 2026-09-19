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

	for row in rows:
		row.label = _owner_label(row.name)

	return rows


def _owner_label(user: str) -> str:
	"""Return the full name of `user`, or the user id when no name resolves."""
	return frappe.get_cached_value("User", user, "full_name") or user


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
) -> dict[str, Any] | None:
	"""Return the chart payload of the top open ToDo owners, or None when there is none."""
	owners = get_top_owners()

	if not owners:
		return None

	return {
		"labels": [owner.label for owner in owners],
		"datasets": [{"name": _("Open ToDos"), "values": [owner["count"] for owner in owners]}],
	}
