# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and Contributors
# License: MIT. See LICENSE
"""Coverage for the baseline security response headers `frappe.app.set_security_headers` adds."""

from pathlib import Path
from unittest.mock import patch

from werkzeug.datastructures import Headers
from werkzeug.wrappers import Response

import frappe
from frappe.app import (
	DEFAULT_CONTENT_SECURITY_POLICY,
	DEFAULT_REFERRER_POLICY,
	DEFAULT_X_CONTENT_TYPE_OPTIONS,
	DEFAULT_X_FRAME_OPTIONS,
	process_response,
)
from frappe.tests import IntegrationTestCase
from frappe.tests.test_api import FrappeAPITestCase

SECURITY_HEADERS = (
	"X-Frame-Options",
	"Content-Security-Policy",
	"X-Content-Type-Options",
	"Referrer-Policy",
)


def get_directive(policy: str, name: str) -> str:
	"""Return the sources of `name` in `policy`, or an empty string when it is absent."""
	for directive in policy.split(";"):
		sources = directive.split()
		if sources and sources[0].lower() == name:
			return " ".join(sources[1:])

	return ""


class TestSecurityHeaders(IntegrationTestCase):
	"""Direct `process_response` coverage of the header baseline (decision RJ-9)."""

	def setUp(self):
		self.original_response_headers = frappe.local.response_headers
		frappe.local.response_headers = Headers()
		self.addCleanup(self.restore_response_headers)

	def restore_response_headers(self):
		frappe.local.response_headers = self.original_response_headers

	def set_conf(self, **values):
		"""Set site config keys for the duration of one test."""
		for key, value in values.items():
			present = key in frappe.conf
			original = frappe.conf.get(key)
			self.addCleanup(self.restore_conf, key, original, present)
			frappe.conf[key] = value

	def restore_conf(self, key, original, present):
		if present:
			frappe.conf[key] = original
		else:
			frappe.conf.pop(key, None)

	def process(self, method="GET", path="/desk", headers=None, response=None) -> Response:
		frappe.utils.set_request(method=method, path=path, headers=headers or {})
		response = response if response is not None else Response()
		process_response(response)
		return response

	def test_all_four_headers_present_with_defaults(self):
		response = self.process()

		for header in SECURITY_HEADERS:
			self.assertIn(header, response.headers)

		self.assertEqual(response.headers["X-Frame-Options"], DEFAULT_X_FRAME_OPTIONS)
		self.assertEqual(response.headers["X-Frame-Options"], "SAMEORIGIN")
		self.assertEqual(response.headers["X-Content-Type-Options"], DEFAULT_X_CONTENT_TYPE_OPTIONS)
		self.assertEqual(response.headers["X-Content-Type-Options"], "nosniff")
		self.assertEqual(response.headers["Referrer-Policy"], DEFAULT_REFERRER_POLICY)
		self.assertEqual(response.headers["Referrer-Policy"], "strict-origin-when-cross-origin")
		self.assertEqual(response.headers["Content-Security-Policy"], DEFAULT_CONTENT_SECURITY_POLICY)

	def test_policy_hardens_framing_objects_and_base_uri(self):
		policy = self.process().headers["Content-Security-Policy"]

		self.assertEqual(get_directive(policy, "frame-ancestors"), "'self'")
		self.assertEqual(get_directive(policy, "object-src"), "'none'")
		self.assertEqual(get_directive(policy, "base-uri"), "'self'")

	def test_policy_allows_same_origin_and_blob_backed_frames(self):
		frame_src = get_directive(self.process().headers["Content-Security-Policy"], "frame-src")

		self.assertIn("'self'", frame_src)
		self.assertIn("blob:", frame_src)

	def test_file_form_pdf_preview_is_a_framed_source(self):
		"""The shipped File form renders its PDF preview through an iframe, not a plugin element."""
		file_js = Path(frappe.get_app_path("frappe", "core", "doctype", "file", "file.js")).read_text()

		self.assertIn("<iframe", file_js)
		self.assertNotIn("<object", file_js)
		self.assertNotIn("<embed", file_js)

	def test_policy_is_not_a_wildcard_policy_and_keeps_the_desk_bundle_working(self):
		policy = self.process().headers["Content-Security-Policy"]

		self.assertNotIn("default-src *", policy)
		self.assertEqual(get_directive(policy, "default-src"), "'self'")

		script_src = get_directive(policy, "script-src")
		self.assertIn("'unsafe-inline'", script_src)
		self.assertIn("'unsafe-eval'", script_src)
		self.assertIn("'self'", script_src)

		style_src = get_directive(policy, "style-src")
		self.assertIn("'unsafe-inline'", style_src)
		self.assertIn("'self'", style_src)

		img_src = get_directive(policy, "img-src")
		self.assertIn("data:", img_src)
		self.assertIn("blob:", img_src)

		connect_src = get_directive(policy, "connect-src")
		self.assertIn("ws:", connect_src)
		self.assertIn("wss:", connect_src)

	def test_explicit_policy_with_embedding_domains_is_preserved(self):
		embedding_policy = "frame-ancestors 'self' https://embed.example"
		frappe.local.response_headers["Content-Security-Policy"] = embedding_policy

		response = self.process()

		self.assertEqual(response.headers["Content-Security-Policy"], embedding_policy)
		self.assertNotIn("X-Frame-Options", response.headers)
		self.assertEqual(response.headers["X-Content-Type-Options"], "nosniff")
		self.assertEqual(response.headers["Referrer-Policy"], DEFAULT_REFERRER_POLICY)

	def test_renderer_policy_on_the_response_is_preserved(self):
		"""A page renderer writes its headers onto the response before `process_response` runs."""
		embedding_policy = "frame-ancestors 'self' https://embed.example https://partner.example"
		response = Response()
		response.headers["Content-Security-Policy"] = embedding_policy

		self.process(response=response)

		self.assertEqual(response.headers["Content-Security-Policy"], embedding_policy)
		self.assertNotIn("X-Frame-Options", response.headers)

	def test_self_only_frame_ancestors_keeps_x_frame_options(self):
		frappe.local.response_headers["Content-Security-Policy"] = "frame-ancestors 'self'"

		response = self.process()

		self.assertEqual(response.headers["Content-Security-Policy"], "frame-ancestors 'self'")
		self.assertEqual(response.headers["X-Frame-Options"], "SAMEORIGIN")

	def test_current_origin_frame_ancestors_keeps_x_frame_options(self):
		current_origin_policy = "frame-ancestors http://test.localhost:8000"
		frappe.local.response_headers["Content-Security-Policy"] = current_origin_policy

		response = self.process(headers={"Host": "test.localhost:8000"})

		self.assertEqual(response.headers["Content-Security-Policy"], current_origin_policy)
		self.assertEqual(response.headers["X-Frame-Options"], "SAMEORIGIN")

	def test_other_origin_frame_ancestors_omits_x_frame_options(self):
		other_origin_policies = (
			"frame-ancestors https://test.localhost:8000",
			"frame-ancestors http://test.localhost:9000",
			"frame-ancestors http://embed.localhost:8000",
			"frame-ancestors https:",
			"frame-ancestors http://*.localhost:8000",
		)

		for policy in other_origin_policies:
			with self.subTest(policy=policy):
				frappe.local.response_headers["Content-Security-Policy"] = policy

				response = self.process(headers={"Host": "test.localhost:8000"})

				self.assertEqual(response.headers["Content-Security-Policy"], policy)
				self.assertNotIn("X-Frame-Options", response.headers)

	def test_request_policy_wins_over_a_self_only_renderer_policy(self):
		embedding_policy = "frame-ancestors 'self' https://embed.example"
		response = Response()
		response.headers["Content-Security-Policy"] = "frame-ancestors 'self'"
		frappe.local.response_headers["Content-Security-Policy"] = embedding_policy

		self.process(response=response)

		self.assertEqual(response.headers["Content-Security-Policy"], embedding_policy)
		self.assertNotIn("X-Frame-Options", response.headers)

	def test_self_only_request_policy_wins_over_an_embedding_renderer_policy(self):
		response = Response()
		response.headers["Content-Security-Policy"] = "frame-ancestors 'self' https://embed.example"
		frappe.local.response_headers["Content-Security-Policy"] = "frame-ancestors 'self'"

		self.process(response=response)

		self.assertEqual(response.headers["Content-Security-Policy"], "frame-ancestors 'self'")
		self.assertEqual(response.headers["X-Frame-Options"], "SAMEORIGIN")

	def test_empty_request_policy_is_served_empty_and_keeps_x_frame_options(self):
		frappe.local.response_headers["Content-Security-Policy"] = ""

		response = self.process()

		self.assertEqual(response.headers["Content-Security-Policy"], "")
		self.assertEqual(response.headers["X-Frame-Options"], "SAMEORIGIN")

	def test_explicit_x_frame_options_wins(self):
		frappe.local.response_headers["X-Frame-Options"] = "DENY"

		response = self.process()

		self.assertEqual(response.headers["X-Frame-Options"], "DENY")

	def test_site_config_overrides_every_header(self):
		self.set_conf(
			x_frame_options="DENY",
			content_security_policy="default-src 'self'; frame-ancestors 'none'",
			x_content_type_options="nosniff",
			referrer_policy="same-origin",
		)

		response = self.process()

		self.assertEqual(response.headers["X-Frame-Options"], "DENY")
		self.assertEqual(
			response.headers["Content-Security-Policy"], "default-src 'self'; frame-ancestors 'none'"
		)
		self.assertEqual(response.headers["X-Content-Type-Options"], "nosniff")
		self.assertEqual(response.headers["Referrer-Policy"], "same-origin")

	def test_empty_site_config_value_omits_a_single_header(self):
		self.set_conf(content_security_policy="")

		response = self.process()

		self.assertNotIn("Content-Security-Policy", response.headers)
		self.assertEqual(response.headers["X-Frame-Options"], "SAMEORIGIN")
		self.assertEqual(response.headers["X-Content-Type-Options"], "nosniff")
		self.assertEqual(response.headers["Referrer-Policy"], DEFAULT_REFERRER_POLICY)

	def test_disable_security_headers_opts_out_of_all_of_them(self):
		self.set_conf(disable_security_headers=1)

		response = self.process()

		for header in SECURITY_HEADERS:
			self.assertNotIn(header, response.headers)

		self.assertIn("Cache-Control", response.headers)

	def test_headers_present_on_cors_response_with_wildcard_origin(self):
		"""A site that allows every CORS origin is not exempt from the header baseline."""
		origin = "http://example.com"
		self.set_conf(allow_cors="*")

		response = self.process(
			method="OPTIONS",
			path="/api/method/ping",
			headers={
				"Origin": origin,
				"Access-Control-Request-Method": "POST",
				"Access-Control-Request-Headers": "X-Test-Header",
			},
		)

		self.assertEqual(response.headers["Access-Control-Allow-Origin"], origin)
		self.assertEqual(response.headers["Access-Control-Allow-Credentials"], "true")

		for header in SECURITY_HEADERS:
			self.assertIn(header, response.headers)

	def test_headers_present_on_error_responses(self):
		response = self.process(response=Response(status=500))

		self.assertEqual(response.status_code, 500)
		for header in SECURITY_HEADERS:
			self.assertIn(header, response.headers)

	def test_dev_server_allows_the_socketio_origin(self):
		self.set_conf(socketio_port=9000)

		with patch("frappe._dev_server", 1):
			response = self.process(headers={"Host": "test.localhost:8000"})

		connect_src = get_directive(response.headers["Content-Security-Policy"], "connect-src")
		self.assertIn("http://test.localhost:9000", connect_src)
		self.assertIn("'self'", connect_src)

	def test_dev_server_adds_the_socketio_origin_to_a_default_src_fallback(self):
		self.set_conf(socketio_port=9000, content_security_policy="default-src 'self' https:")

		with patch("frappe._dev_server", 1):
			response = self.process(headers={"Host": "test.localhost:8000"})

		policy = response.headers["Content-Security-Policy"]
		self.assertEqual(get_directive(policy, "default-src"), "'self' https:")
		self.assertEqual(get_directive(policy, "connect-src"), "'self' https: http://test.localhost:9000")

	def test_dev_server_socketio_origin_omits_a_none_default_source(self):
		self.set_conf(socketio_port=9000, content_security_policy="default-src 'none'; img-src 'self'")

		with patch("frappe._dev_server", 1):
			response = self.process(headers={"Host": "test.localhost:8000"})

		policy = response.headers["Content-Security-Policy"]
		self.assertEqual(get_directive(policy, "connect-src"), "http://test.localhost:9000")
		self.assertEqual(get_directive(policy, "default-src"), "'none'")

	def test_dev_server_leaves_a_policy_without_connect_or_default_sources_unchanged(self):
		configured_policy = "img-src 'self'; frame-ancestors 'self'"
		self.set_conf(socketio_port=9000, content_security_policy=configured_policy)

		with patch("frappe._dev_server", 1):
			response = self.process(headers={"Host": "test.localhost:8000"})

		policy = response.headers["Content-Security-Policy"]
		self.assertEqual(policy, configured_policy)
		self.assertEqual(get_directive(policy, "connect-src"), "")

	def test_socketio_origin_absent_without_the_dev_server(self):
		self.set_conf(socketio_port=9000)

		connect_src = get_directive(self.process().headers["Content-Security-Policy"], "connect-src")

		self.assertNotIn(":9000", connect_src)


class TestSecurityHeadersOnDesk(FrappeAPITestCase):
	"""Exercise the headers over HTTP, on the responses a browser actually receives."""

	def send_sid_cookie(self, sid):
		"""Send `sid` as the session cookie of every request this test makes."""
		self.TEST_CLIENT.set_cookie("sid", sid, domain="localhost")
		self.addCleanup(self.TEST_CLIENT.delete_cookie, "sid", domain="localhost")

	def assert_security_headers(self, response):
		for header in SECURITY_HEADERS:
			self.assertIn(header, response.headers, msg=f"{header} missing from {response.status}")

		self.assertEqual(response.headers["X-Content-Type-Options"], "nosniff")
		self.assertEqual(response.headers["X-Frame-Options"], "SAMEORIGIN")
		self.assertEqual(response.headers["Referrer-Policy"], "strict-origin-when-cross-origin")
		self.assertIn("frame-ancestors 'self'", response.headers["Content-Security-Policy"])

	def test_desk_page_carries_the_headers(self):
		self.send_sid_cookie(self.sid)

		response = self.get("/desk")

		self.assertEqual(response.status_code, 200)
		self.assertIn("text/html", response.headers["Content-Type"])
		self.assert_security_headers(response)

	def test_desk_dashboard_page_carries_the_headers(self):
		self.send_sid_cookie(self.sid)

		response = self.get("/desk/dashboard-view/ToDo Analytics")

		self.assertEqual(response.status_code, 200)
		self.assertIn("text/html", response.headers["Content-Type"])
		self.assert_security_headers(response)

	def test_api_response_carries_the_headers(self):
		response = self.get("/api/method/ping")

		self.assertEqual(response.json, {"message": "pong"})
		self.assert_security_headers(response)

	def test_login_page_carries_the_headers(self):
		self.send_sid_cookie("Guest")

		response = self.get("/login")

		self.assertEqual(response.status_code, 200)
		self.assertIn("text/html", response.headers["Content-Type"])
		self.assert_security_headers(response)

	def test_web_form_keeps_its_own_embedding_policy(self):
		self.send_sid_cookie("Guest")

		web_form = frappe.get_doc(
			doctype="Web Form",
			title="test-security-headers-embed",
			route="test-security-headers-embed",
			doc_type="ToDo",
			module="Desk",
			is_standard=0,
			published=1,
			login_required=0,
			allow_multiple=1,
			allowed_embedding_domains="https://embed.example",
			web_form_fields=[
				{"fieldname": "description", "fieldtype": "Text Editor", "label": "Description"}
			],
		).insert(ignore_permissions=True)
		# commit the HTTP-visible fixture (decision RJ-10)
		frappe.db.commit()  # nosemgrep: frappe-manual-commit
		self.addCleanup(self.delete_web_form, web_form.name)

		response = self.get(f"/{web_form.route}/new")

		self.assertEqual(response.status_code, 200)
		self.assertEqual(
			response.headers["Content-Security-Policy"], "frame-ancestors 'self' https://embed.example"
		)
		self.assertNotIn("X-Frame-Options", response.headers)
		self.assertEqual(response.headers["X-Content-Type-Options"], "nosniff")
		self.assertEqual(response.headers["Referrer-Policy"], "strict-origin-when-cross-origin")

	def delete_web_form(self, name):
		frappe.delete_doc("Web Form", name, force=True, ignore_permissions=True)
		# commit the fixture cleanup (decision RJ-10)
		frappe.db.commit()  # nosemgrep: frappe-manual-commit
