# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and Contributors
# License: MIT. See LICENSE

import json

import frappe
from frappe.desk.dashboard_chart_source.todo_created_vs_completed.todo_created_vs_completed import (
	get as get_created_vs_completed,
)
from frappe.desk.dashboard_chart_source.todo_top_owners.todo_top_owners import get as get_top_owners_chart
from frappe.desk.doctype.dashboard.dashboard import get_permitted_cards, get_permitted_charts
from frappe.desk.doctype.dashboard_chart_source.dashboard_chart_source import get_config
from frappe.desk.doctype.number_card.number_card import get_result
from frappe.tests import IntegrationTestCase
from frappe.utils import cint

EXTRA_TEST_RECORD_DEPENDENCIES = ["User"]

DASHBOARD = "ToDo Analytics"
OPEN_CARD = "ToDo Total Open"
CLOSED_CARD = "ToDo Total Closed"
TREND_CHART = "ToDo Created vs Completed"
TOP_OWNERS_CHART = "ToDo Top Owners"
DESK_USER = "test2@example.com"


class TestToDoAnalyticsDashboard(IntegrationTestCase):
	def setUp(self):
		super().setUp()
		frappe.db.delete("ToDo")
		for chart in (TREND_CHART, TOP_OWNERS_CHART):
			frappe.cache.delete_keys(f"chart-data:{chart}")

	def _make_todo(self, status="Open", allocated_to=None):
		return frappe.get_doc(
			doctype="ToDo",
			description=f"ToDo Analytics {status}",
			status=status,
			allocated_to=allocated_to,
			assigned_by="Administrator",
		).insert()

	def _set_user_type(self, user, user_type):
		frappe.db.set_value("User", user, "user_type", user_type, update_modified=False)
		frappe.clear_cache(user=user)

	def test_open_and_closed_cards_count_seeded_todos(self):
		for _ in range(3):
			self._make_todo(status="Open")
		for _ in range(2):
			self._make_todo(status="Closed")
		self._make_todo(status="Cancelled")

		for card_name, expected in ((OPEN_CARD, 3.0), (CLOSED_CARD, 2.0)):
			card = frappe.get_doc("Number Card", card_name)
			result = get_result(doc=card.as_dict(), filters=json.loads(card.filters_json))
			self.assertEqual(result, expected, msg=f"{card_name} did not count the seeded ToDos")

	def test_cards_empty_state_zero(self):
		for card_name in (OPEN_CARD, CLOSED_CARD):
			card = frappe.get_doc("Number Card", card_name)
			result = get_result(doc=card.as_dict(), filters=json.loads(card.filters_json))
			self.assertEqual(result, 0.0, msg=f"{card_name} did not return zero for an empty ToDo table")

	def test_standard_records_exist(self):
		"""The dashboard, both cards, both charts and both chart sources ship as Desk module records."""
		standard_records = (
			("Dashboard", DASHBOARD),
			("Number Card", OPEN_CARD),
			("Number Card", CLOSED_CARD),
			("Dashboard Chart", TREND_CHART),
			("Dashboard Chart", TOP_OWNERS_CHART),
		)
		for doctype, name in standard_records:
			self.assertTrue(frappe.db.exists(doctype, name), msg=f"{doctype} {name} does not exist")
			is_standard, module = frappe.db.get_value(doctype, name, ["is_standard", "module"])
			self.assertEqual(cint(is_standard), 1, msg=f"{doctype} {name} is not standard")
			self.assertEqual(module, "Desk", msg=f"{doctype} {name} is not a Desk module record")

		for source_name, timeseries in ((TREND_CHART, 1), (TOP_OWNERS_CHART, 0)):
			self.assertTrue(
				frappe.db.exists("Dashboard Chart Source", source_name),
				msg=f"Dashboard Chart Source {source_name} does not exist",
			)
			module, stored_timeseries = frappe.db.get_value(
				"Dashboard Chart Source", source_name, ["module", "timeseries"]
			)
			self.assertEqual(module, "Desk", msg=f"Chart source {source_name} is not a Desk module record")
			self.assertEqual(
				cint(stored_timeseries),
				timeseries,
				msg=f"Chart source {source_name} carries the wrong timeseries value",
			)

	def test_chart_sources_record_the_last_sync_on_a_widget_refresh(self):
		self._make_todo(status="Open", allocated_to="Administrator")

		for source, chart_name in (
			(get_created_vs_completed, TREND_CHART),
			(get_top_owners_chart, TOP_OWNERS_CHART),
		):
			with self.subTest(chart=chart_name):
				frappe.db.set_value(
					"Dashboard Chart", chart_name, "last_synced_on", None, update_modified=False
				)

				self.assertIsNotNone(source(chart_name=chart_name, refresh=1))
				self.assertIsNotNone(
					frappe.db.get_value("Dashboard Chart", chart_name, "last_synced_on"),
					msg=f"Chart source {chart_name} did not record last_synced_on",
				)

	def test_dashboard_loads_all_four_components(self):
		"""The dashboard yields both cards and both charts, and every backing server call returns data."""
		self._make_todo(status="Open", allocated_to="Administrator")

		cards = get_permitted_cards(DASHBOARD)
		self.assertEqual(len(cards), 2)
		self.assertEqual({row.card for row in cards}, {OPEN_CARD, CLOSED_CARD})

		charts = get_permitted_charts(DASHBOARD)
		self.assertEqual(len(charts), 2)
		self.assertEqual({row.chart for row in charts}, {TREND_CHART, TOP_OWNERS_CHART})
		for row in charts:
			self.assertEqual(row.width, "Full", msg=f"Chart {row.chart} is not rendered at full width")

		for source_name in (TREND_CHART, TOP_OWNERS_CHART):
			self.assertTrue(get_config(source_name), msg=f"Chart source {source_name} ships no client config")

		trend = get_created_vs_completed(chart_name=TREND_CHART, no_cache=1)
		self.assertIn("labels", trend)
		self.assertTrue(trend["labels"])
		self.assertEqual(len(trend["datasets"]), 2)
		for dataset in trend["datasets"]:
			self.assertEqual(len(dataset["values"]), len(trend["labels"]))

		owners = get_top_owners_chart(chart_name=TOP_OWNERS_CHART, no_cache=1)
		self.assertIsNotNone(owners)
		self.assertIn("labels", owners)
		self.assertEqual(len(owners["labels"]), 1)
		self.assertEqual(len(owners["datasets"]), 1)
		self.assertEqual(cint(owners["datasets"][0]["values"][0]), 1)

		for card_name, expected in ((OPEN_CARD, 1.0), (CLOSED_CARD, 0.0)):
			card = frappe.get_doc("Number Card", card_name)
			result = get_result(doc=card.as_dict(), filters=json.loads(card.filters_json))
			self.assertEqual(result, expected, msg=f"{card_name} did not return a result")

	def test_dashboard_visible_to_desk_user(self):
		"""A Desk user without the System Manager role reads the dashboard, both cards and both charts."""
		for chart_name in (TREND_CHART, TOP_OWNERS_CHART):
			self.assertEqual(
				frappe.get_doc("Dashboard Chart", chart_name).roles,
				[],
				msg=f"Dashboard Chart {chart_name} restricts access to a role",
			)

		self.addCleanup(self._set_user_type, DESK_USER, frappe.db.get_value("User", DESK_USER, "user_type"))
		self._set_user_type(DESK_USER, "System User")

		with self.set_user(DESK_USER):
			roles = frappe.get_roles()
			self.assertIn("Desk User", roles, msg=f"{DESK_USER} holds no Desk access")
			self.assertNotIn("System Manager", roles, msg=f"{DESK_USER} holds the System Manager role")
			self.assertTrue(
				frappe.has_permission("Dashboard", doc=DASHBOARD),
				msg=f"{DESK_USER} cannot read Dashboard {DASHBOARD}",
			)
			self.assertEqual(
				len(get_permitted_cards(DASHBOARD)), 2, msg=f"{DESK_USER} is not permitted both cards"
			)
			self.assertEqual(
				len(get_permitted_charts(DASHBOARD)), 2, msg=f"{DESK_USER} is not permitted both charts"
			)
