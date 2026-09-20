# Copyright (c) 2019, Frappe Technologies and Contributors
# License: MIT. See LICENSE
import frappe
from frappe.desk.doctype.dashboard_chart_source.dashboard_chart_source import (
	get_config,
	has_config_permission,
)
from frappe.tests import IntegrationTestCase

EXTRA_TEST_RECORD_DEPENDENCIES = ["User"]

SYSTEM_MANAGER = "test@example.com"
DESK_USER = "_test_chart_source_desk@example.com"
WEBSITE_USER = "_test_chart_source_web@example.com"

SOURCE_WITH_READABLE_CHART = "_Test Chart Source Readable"
SOURCE_WITH_RESTRICTED_CHART = "_Test Chart Source Restricted"
SOURCE_WITHOUT_CHART = "_Test Chart Source Unused"

READABLE_CHART = "_Test Chart Source Readable Chart"
RESTRICTED_CHART = "_Test Chart Source Restricted Chart"


class TestDashboardChartSource(IntegrationTestCase):
	def setUp(self):
		super().setUp()
		for source_name in (
			SOURCE_WITH_READABLE_CHART,
			SOURCE_WITH_RESTRICTED_CHART,
			SOURCE_WITHOUT_CHART,
		):
			if not frappe.db.exists("Dashboard Chart Source", source_name):
				frappe.get_doc(
					doctype="Dashboard Chart Source",
					source_name=source_name,
					module="Desk",
					timeseries=0,
				).insert()

		self._make_chart(READABLE_CHART, SOURCE_WITH_READABLE_CHART, roles=[])
		self._make_chart(RESTRICTED_CHART, SOURCE_WITH_RESTRICTED_CHART, roles=["System Manager"])

		self._make_user(DESK_USER, "System User", roles=["Desk User"])
		self._make_user(WEBSITE_USER, "Website User", roles=[])

	def _make_chart(self, chart_name, source, roles):
		"""Create a non-standard Custom chart on `source`, restricted to `roles` when given."""
		if frappe.db.exists("Dashboard Chart", chart_name):
			return

		frappe.get_doc(
			doctype="Dashboard Chart",
			chart_name=chart_name,
			chart_type="Custom",
			source=source,
			document_type="ToDo",
			type="Bar",
			filters_json="[]",
			is_standard=0,
			roles=[{"role": role} for role in roles],
		).insert()

	def _make_user(self, email, user_type, roles):
		"""Create a user holding exactly `roles`, so no other test's role changes reach these tests."""
		if not frappe.db.exists("User", email):
			frappe.get_doc(
				doctype="User",
				email=email,
				first_name=email.split("@")[0],
				send_welcome_email=0,
				roles=[{"role": role} for role in roles],
			).insert(ignore_permissions=True)

		self.assertEqual(frappe.db.get_value("User", email, "user_type"), user_type)
		self.assertEqual(
			sorted(frappe.get_all("Has Role", filters={"parent": email, "parenttype": "User"}, pluck="role")),
			sorted(roles),
		)

	def test_config_served_to_read_permission_holder(self):
		with self.set_user(SYSTEM_MANAGER):
			self.assertTrue(frappe.has_permission("Dashboard Chart Source", "read"))
			self.assertTrue(has_config_permission(SOURCE_WITHOUT_CHART))
			self.assertEqual(get_config(SOURCE_WITHOUT_CHART), "")

	def test_config_served_to_user_who_can_read_a_chart_of_the_source(self):
		with self.set_user(DESK_USER):
			self.assertIn("Desk User", frappe.get_roles())
			self.assertNotIn("System Manager", frappe.get_roles())
			self.assertFalse(frappe.has_permission("Dashboard Chart Source", "read"))
			self.assertTrue(frappe.has_permission("Dashboard Chart", doc=READABLE_CHART))
			self.assertTrue(has_config_permission(SOURCE_WITH_READABLE_CHART))
			self.assertEqual(get_config(SOURCE_WITH_READABLE_CHART), "")

	def test_config_denied_for_source_without_any_chart(self):
		with self.set_user(DESK_USER):
			self.assertFalse(has_config_permission(SOURCE_WITHOUT_CHART))
			self.assertRaises(frappe.PermissionError, get_config, SOURCE_WITHOUT_CHART)

	def test_config_denied_when_the_only_chart_is_role_restricted(self):
		with self.set_user(DESK_USER):
			self.assertFalse(frappe.has_permission("Dashboard Chart", doc=RESTRICTED_CHART))
			self.assertFalse(has_config_permission(SOURCE_WITH_RESTRICTED_CHART))
			self.assertRaises(frappe.PermissionError, get_config, SOURCE_WITH_RESTRICTED_CHART)

	def test_config_denied_for_user_without_desk_access(self):
		with self.set_user(WEBSITE_USER):
			self.assertNotIn("Desk User", frappe.get_roles())
			for source_name in (
				SOURCE_WITH_READABLE_CHART,
				SOURCE_WITH_RESTRICTED_CHART,
				SOURCE_WITHOUT_CHART,
			):
				self.assertFalse(has_config_permission(source_name))
				self.assertRaises(frappe.PermissionError, get_config, source_name)

	def test_config_permission_evaluated_for_an_explicit_user(self):
		self.assertTrue(has_config_permission(SOURCE_WITH_READABLE_CHART, user=DESK_USER))
		self.assertFalse(has_config_permission(SOURCE_WITH_RESTRICTED_CHART, user=DESK_USER))
		self.assertFalse(has_config_permission(SOURCE_WITH_READABLE_CHART, user=WEBSITE_USER))

	def test_missing_source_reported_as_not_found_to_read_permission_holder(self):
		with self.set_user(SYSTEM_MANAGER):
			self.assertRaises(frappe.DoesNotExistError, get_config, "_Test Chart Source Absent")
