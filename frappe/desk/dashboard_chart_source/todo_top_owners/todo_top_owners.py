# Copyright (c) 2026, Frappe Technologies and contributors
# License: MIT. See LICENSE

from datetime import datetime
from functools import wraps
from typing import Any

import frappe
from frappe import _
from frappe.utils import cint, cstr, sha256_hash
from frappe.utils.dashboard import cache_source

TOP_N = 5
CACHE_EXPIRY_SECONDS = 5 * 60
CACHE_DIMENSIONS = (
	"chart",
	"filters",
	"from_date",
	"to_date",
	"timespan",
	"time_interval",
	"heatmap_year",
)


def get_top_owners(limit: int = TOP_N) -> list[dict[str, Any]]:
	"""Return the top `limit` users by open ToDo count, as rows of `name`, `count` and `label`.

	`limit` must be an integer from 1 to `TOP_N`; booleans, non-integers and out-of-range
	values raise `frappe.ValidationError` before any query runs.
	"""
	if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= TOP_N:
		frappe.throw(
			_("Limit must be an integer between 1 and {0}").format(TOP_N),
			title=_("Invalid Limit"),
		)

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


def _cache_key(kwargs: dict[str, Any]) -> str:
	"""Return the cache key of the payload for the given request arguments.

	The key is `chart-data:<chart name>:<digest>`, where the digest covers the calling user
	and every request argument listed in `CACHE_DIMENSIONS`.
	"""
	dimensions = [frappe.session.user, *(cstr(kwargs.get(name)) for name in CACHE_DIMENSIONS)]

	return f"chart-data:{cstr(kwargs.get('chart_name'))}:{sha256_hash('|'.join(dimensions))}"


def _cache_payload(function):
	"""Serve the payload of `function` from the site cache for `CACHE_EXPIRY_SECONDS`.

	A cached payload is returned only for the user and the request arguments it was computed
	for. `refresh` recomputes and repopulates the entry, `no_cache` neither reads nor writes
	it, a `None` payload is not cached, and an unsaved chart payload is always computed. A
	payload that has to be computed is requested with `no_cache`; this decorator is the only
	caching layer of the call.
	"""

	@wraps(function)
	def wrapper(*args, **kwargs):
		if args or kwargs.get("no_cache"):
			return function(*args, **kwargs)

		if not kwargs.get("chart_name"):
			return function(**dict(kwargs, no_cache=1))

		cache_key = _cache_key(kwargs)

		if not cint(kwargs.get("refresh")):
			payload = frappe.cache.get_value(cache_key)
			if payload is not None:
				return payload

		payload = function(**dict(kwargs, no_cache=1))

		if payload is not None:
			frappe.cache.set_value(cache_key, payload, expires_in_sec=CACHE_EXPIRY_SECONDS)

		return payload

	return wrapper


@frappe.whitelist()
@_cache_payload
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
