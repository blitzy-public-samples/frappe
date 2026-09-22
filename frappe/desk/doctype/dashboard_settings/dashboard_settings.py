# Copyright (c) 2020, Frappe Technologies and contributors
# License: MIT. See LICENSE

import json
from typing import Any

import frappe
from frappe import _

# import frappe
from frappe.model.document import Document


class DashboardSettings(Document):
	_DOCTYPE_NAME = "Dashboard Settings"

	# begin: auto-generated types
	# This code is auto-generated. Do not modify anything in this block.

	from typing import TYPE_CHECKING

	if TYPE_CHECKING:
		from frappe.types import DF

		chart_config: DF.Code | None
		user: DF.Link | None
	# end: auto-generated types

	pass


@frappe.whitelist()
def create_dashboard_settings(user: str):
	if not frappe.db.exists("Dashboard Settings", user):
		doc = frappe.new_doc("Dashboard Settings")
		doc.name = user
		doc.insert(ignore_permissions=True)
		frappe.db.commit()
		return doc


def get_permission_query_conditions(user):
	if not user:
		user = frappe.session.user

	return f"""(`tabDashboard Settings`.name = {frappe.db.escape(user)})"""


@frappe.whitelist()
def save_chart_config(reset: int | str | bool, config: str | dict[str, Any], chart_name: str):
	"""Store one chart's settings for the current user in Dashboard Settings `chart_config`.

	`reset` empties this chart's entry; otherwise `config` is merged into it. Every other
	chart's entry is carried over unchanged.

	The stored JSON is read with a row lock on this user's Dashboard Settings record, held
	until the request commits: a concurrent request for another chart of the same user reads
	the configuration this request has written.

	A user who has no Dashboard Settings record raises `frappe.DoesNotExistError`.
	"""
	reset = frappe.parse_json(reset)
	settings = frappe.db.get_value(
		"Dashboard Settings",
		frappe.session.user,
		"chart_config",
		as_dict=True,
		for_update=True,
	)

	if settings is None:
		frappe.throw(
			_("Dashboard Settings {0} not found").format(frappe.session.user),
			frappe.DoesNotExistError,
		)

	chart_config = frappe.parse_json(settings.chart_config) or {}

	if reset:
		chart_config[chart_name] = {}
	else:
		config = frappe.parse_json(config)
		if chart_name not in chart_config:
			chart_config[chart_name] = {}
		chart_config[chart_name].update(config)

	frappe.db.set_value("Dashboard Settings", frappe.session.user, "chart_config", json.dumps(chart_config))
