# Copyright (c) 2021, Frappe Technologies Pvt. Ltd. and Contributors
# License: MIT. See LICENSE
import base64
import datetime
import time
from functools import cached_property

import requests
from werkzeug.test import EnvironBuilder
from werkzeug.wrappers import Request

import frappe
from frappe.auth import (
	HTTPRequest,
	LoginAttemptTracker,
	get_hostname,
	get_origin,
	validate_deferred_csrf_rejection,
)
from frappe.core.doctype.user.user import generate_keys
from frappe.frappeclient import AuthError, FrappeClient
from frappe.sessions import Session, get_expired_sessions, get_expiry_in_seconds
from frappe.tests import IntegrationTestCase, UnitTestCase
from frappe.tests.test_api import FrappeAPITestCase, make_request
from frappe.utils import get_datetime, get_site_url, get_test_client, now, set_request
from frappe.utils.data import add_to_date
from frappe.utils.password import (
	get_decrypted_password,
	remove_encrypted_password,
	set_encrypted_password,
)
from frappe.www.login import _generate_temporary_login_link

BEFORE_REQUEST_CALLS: list[tuple[str, str | None]] = []


def record_before_request() -> None:
	"""Append the session user and `Authorization` header of the request reaching the
	`before_request` stage to `BEFORE_REQUEST_CALLS`."""
	BEFORE_REQUEST_CALLS.append((frappe.session.user, frappe.get_request_header("Authorization")))


def add_user(email, password, username=None, mobile_no=None):
	first_name = email.split("@", 1)[0]
	user = frappe.get_doc(
		doctype="User", email=email, first_name=first_name, username=username, mobile_no=mobile_no
	).insert()
	user.new_password = password
	user.simultaneous_sessions = 1
	user.add_roles("System Manager")
	frappe.db.commit()


class TestAuth(IntegrationTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.HOST_NAME = frappe.get_site_config().host_name or get_site_url(frappe.local.site)
		cls.test_user_email = "test_auth@test.com"
		cls.test_user_name = "test_auth_user"
		cls.test_user_mobile = "+911234567890"
		cls.test_user_password = "pwd_012"

		cls.tearDownClass()
		add_user(
			email=cls.test_user_email,
			password=cls.test_user_password,
			username=cls.test_user_name,
			mobile_no=cls.test_user_mobile,
		)

	@classmethod
	def tearDownClass(cls):
		frappe.db.rollback()
		frappe.delete_doc("User", cls.test_user_email, force=True)
		frappe.local.request_ip = None
		frappe.form_dict.email = None
		frappe.local.response["http_status_code"] = None
		frappe.db.commit()

	def set_system_settings(self, k, v):
		frappe.db.set_single_value("System Settings", k, v)
		frappe.clear_cache()
		frappe.db.commit()

	def test_allow_login_using_mobile(self):
		self.set_system_settings("allow_login_using_mobile_number", 1)
		self.set_system_settings("allow_login_using_user_name", 0)

		# Login by both email and mobile should work
		FrappeClient(self.HOST_NAME, self.test_user_mobile, self.test_user_password)
		FrappeClient(self.HOST_NAME, self.test_user_email, self.test_user_password)

		# login by username should fail
		with self.assertRaises(AuthError):
			FrappeClient(self.HOST_NAME, self.test_user_name, self.test_user_password)

	def test_allow_login_using_only_email(self):
		self.set_system_settings("allow_login_using_mobile_number", 0)
		self.set_system_settings("allow_login_using_user_name", 0)

		# Login by mobile number should fail
		with self.assertRaises(AuthError):
			FrappeClient(self.HOST_NAME, self.test_user_mobile, self.test_user_password)

		# login by username should fail
		with self.assertRaises(AuthError):
			FrappeClient(self.HOST_NAME, self.test_user_name, self.test_user_password)

		# Login by email should work
		FrappeClient(self.HOST_NAME, self.test_user_email, self.test_user_password)

	def test_allow_login_using_username(self):
		self.set_system_settings("allow_login_using_mobile_number", 0)
		self.set_system_settings("allow_login_using_user_name", 1)

		# Mobile login should fail
		with self.assertRaises(AuthError):
			FrappeClient(self.HOST_NAME, self.test_user_mobile, self.test_user_password)

		# Both email and username logins should work
		FrappeClient(self.HOST_NAME, self.test_user_email, self.test_user_password)
		FrappeClient(self.HOST_NAME, self.test_user_name, self.test_user_password)

	def test_allow_login_using_username_and_mobile(self):
		self.set_system_settings("allow_login_using_mobile_number", 1)
		self.set_system_settings("allow_login_using_user_name", 1)

		# Both email and username and mobile logins should work
		FrappeClient(self.HOST_NAME, self.test_user_mobile, self.test_user_password)
		FrappeClient(self.HOST_NAME, self.test_user_email, self.test_user_password)
		FrappeClient(self.HOST_NAME, self.test_user_name, self.test_user_password)

	def test_deny_multiple_login(self):
		self.set_system_settings("deny_multiple_sessions", 1)
		self.addCleanup(self.set_system_settings, "deny_multiple_sessions", 0)

		first_login = FrappeClient(self.HOST_NAME, self.test_user_email, self.test_user_password)
		first_login.get_list("ToDo")

		second_login = FrappeClient(self.HOST_NAME, self.test_user_email, self.test_user_password)
		second_login.get_list("ToDo")
		with self.assertRaises(Exception):
			first_login.get_list("ToDo")

		third_login = FrappeClient(self.HOST_NAME, self.test_user_email, self.test_user_password)
		with self.assertRaises(Exception):
			first_login.get_list("ToDo")
		with self.assertRaises(Exception):
			second_login.get_list("ToDo")
		third_login.get_list("ToDo")

	def test_disable_user_pass_login(self):
		FrappeClient(self.HOST_NAME, self.test_user_email, self.test_user_password).get_list("ToDo")
		self.set_system_settings("disable_user_pass_login", 1)
		self.addCleanup(self.set_system_settings, "disable_user_pass_login", 0)

		with self.assertRaises(Exception):
			FrappeClient(self.HOST_NAME, self.test_user_email, self.test_user_password).get_list("ToDo")

	def test_login_with_email_link(self):
		user = self.test_user_email

		# Logs in
		res = requests.get(_generate_temporary_login_link(user, 10))
		self.assertEqual(res.status_code, 200)
		self.assertTrue(res.cookies.get("sid"))
		self.assertNotEqual(res.cookies.get("sid"), "Guest")

		# Random incorrect URL
		res = requests.get(_generate_temporary_login_link(user, 10) + "aa")
		self.assertEqual(res.cookies.get("sid"), "Guest")

		# POST doesn't work
		res = requests.post(_generate_temporary_login_link(user, 10))
		self.assertEqual(res.status_code, 403)

		# Rate limiting
		for _ in range(6):
			res = requests.get(_generate_temporary_login_link(user, 10))
			if res.status_code == 429:
				break
		else:
			self.fail("Rate limting not working")

	def test_correct_cookie_expiry_set(self):
		client = FrappeClient(self.HOST_NAME, self.test_user_email, self.test_user_password)

		expiry_time = next(x for x in client.session.cookies if x.name == "sid").expires
		current_time = datetime.datetime.now(tz=datetime.UTC).timestamp()
		self.assertAlmostEqual(get_expiry_in_seconds(), expiry_time - current_time, delta=60 * 60)


class TestAllowedReferrer(UnitTestCase):
	def test_is_allowed_referrer(self):
		def create_request(headers):
			builder = EnvironBuilder(headers=headers)
			env = builder.get_environ()
			return Request(env)

		# Set a single allowed referrer
		frappe.cache.set_value("allowed_referrers", ["https://example.com"])

		# Test with valid referrer
		frappe.local.request = create_request({"Referer": "https://example.com/some/path"})
		http_request = frappe.auth.HTTPRequest()
		self.assertTrue(http_request.is_allowed_referrer())

		# Test with invalid referrer
		frappe.local.request = create_request({"Referer": "https://malicious.com"})
		http_request = frappe.auth.HTTPRequest()
		self.assertFalse(http_request.is_allowed_referrer())

		# Test with valid origin
		frappe.local.request = create_request({"Origin": "https://example.com"})
		http_request = frappe.auth.HTTPRequest()
		self.assertTrue(http_request.is_allowed_referrer())

		# Test with invalid origin
		frappe.local.request = create_request({"Origin": "https://malicious.com"})
		http_request = frappe.auth.HTTPRequest()
		self.assertFalse(http_request.is_allowed_referrer())

		# Test subdomain bypass prevention
		frappe.local.request = create_request({"Referer": "https://example.com.evil.com"})
		http_request = frappe.auth.HTTPRequest()
		self.assertFalse(http_request.is_allowed_referrer())

		# Test exact domain match for referrer
		frappe.local.request = create_request({"Referer": "https://example.com"})
		http_request = frappe.auth.HTTPRequest()
		self.assertTrue(http_request.is_allowed_referrer())

		# Clean up
		frappe.cache.delete_value("allowed_referrers")
		frappe.local.request = None


class TestLoginAttemptTracker(IntegrationTestCase):
	def test_account_lock(self):
		"""Make sure that account locks after `n consecutive failures"""
		tracker = LoginAttemptTracker("tester", max_consecutive_login_attempts=3, lock_interval=60)
		# Clear the cache by setting attempt as success
		tracker.add_success_attempt()

		tracker.add_failure_attempt()
		self.assertTrue(tracker.is_user_allowed())

		tracker.add_failure_attempt()
		self.assertTrue(tracker.is_user_allowed())

		tracker.add_failure_attempt()
		self.assertTrue(tracker.is_user_allowed())

		tracker.add_failure_attempt()
		self.assertFalse(tracker.is_user_allowed())

	def test_account_unlock(self):
		"""Make sure that locked account gets unlocked after lock_interval of time."""
		lock_interval = 2  # In sec
		tracker = LoginAttemptTracker("tester", max_consecutive_login_attempts=1, lock_interval=lock_interval)
		# Clear the cache by setting attempt as success
		tracker.add_success_attempt()

		tracker.add_failure_attempt()
		self.assertTrue(tracker.is_user_allowed())

		tracker.add_failure_attempt()
		self.assertFalse(tracker.is_user_allowed())

		# Sleep for lock_interval of time, so that next request con unlock the user access.
		time.sleep(lock_interval)

		tracker.add_failure_attempt()
		self.assertTrue(tracker.is_user_allowed())


class TestSessionExpiry(FrappeAPITestCase):
	def test_session_expires(self):
		sid = self.sid  # triggers login for test case login
		s: Session = frappe.local.session_obj

		expiry_in = get_expiry_in_seconds()
		session_created = now()

		# Try with 1% increments of times, it should always work
		for step in range(0, 100, 1):
			seconds_elapsed = expiry_in * step / 100

			time_now = add_to_date(session_created, seconds=seconds_elapsed, as_string=True)
			with self.freeze_time(time_now):
				data = s.get_session_data_from_db()
				self.assertEqual(data.user, "Administrator")

		# 1% higher should immediately expire
		time_of_expiry = add_to_date(session_created, seconds=expiry_in * 1.01, as_string=True)
		with self.freeze_time(time_of_expiry):
			self.assertIn(sid, get_expired_sessions())
			self.assertFalse(s.get_session_data_from_db())

	def test_expired_session_answers_401_without_leaking_method(self):
		from frappe.auth import get_logged_user

		frappe.set_user("Guest")
		self.addCleanup(frappe.set_user, "Administrator")
		self.addCleanup(frappe.local.response.pop, "session_expired", None)
		self.addCleanup(frappe.clear_messages)

		frappe.local.response["session_expired"] = 1
		frappe.clear_messages()
		with self.assertRaises(frappe.SessionExpired):
			frappe.is_whitelisted(get_logged_user)
		self.assertEqual(
			frappe.get_message_log(), [], "an expired session must not send a message to the client"
		)

		frappe.local.response.pop("session_expired", None)
		with self.assertRaises(frappe.PermissionError):
			frappe.is_whitelisted(get_logged_user)

		def not_whitelisted():
			pass

		frappe.local.response["session_expired"] = 1
		with self.assertRaises(frappe.PermissionError):
			frappe.is_whitelisted(not_whitelisted)


class TestCSRFTokenValidation(IntegrationTestCase):
	"""Cover `HTTPRequest.validate_csrf_token` for sessions that hold a CSRF token and for sessions
	that do not, such as a cookie session created by `POST /api/method/login`."""

	SITE_HOST = "csrf-host.example"
	SITE_ORIGIN = f"http://{SITE_HOST}"
	FOREIGN_ORIGIN = "http://evil.example.com"
	SESSION_TOKEN = "a-stored-session-csrf-token"

	# `Authorization` values in the schemes `validate_auth` authenticates, and in schemes and
	# shapes it does not
	API_KEY_CREDENTIAL = "an-api-key:an-api-secret"
	BASIC_CREDENTIAL = "YW4tYXBpLWtleTphbi1hcGktc2VjcmV0"
	BEARER_CREDENTIAL = "an-oauth-bearer-token"
	SUPPORTED_AUTHORIZATION = (
		f"Basic {BASIC_CREDENTIAL}",
		f"token {API_KEY_CREDENTIAL}",
		f"Bearer {BEARER_CREDENTIAL}",
	)
	CASED_AUTHORIZATION = (
		f"basic {BASIC_CREDENTIAL}",
		f"TOKEN {API_KEY_CREDENTIAL}",
		f"BEARER {BEARER_CREDENTIAL}",
	)
	UNSUPPORTED_AUTHORIZATION = (
		f"Negotiate {BEARER_CREDENTIAL}",
		"Bearer",
		f"Digest {API_KEY_CREDENTIAL} extra-part",
		API_KEY_CREDENTIAL,
	)

	def setUp(self):
		self.addCleanup(
			self.restore_request_context,
			getattr(frappe.local, "request", None),
			getattr(frappe.local, "session", None),
			getattr(frappe.local, "form_dict", None),
			getattr(frappe.local, "session_obj", None),
		)
		for key in ("ignore_csrf", "allow_cors", "allowed_referrers"):
			self.addCleanup(self.restore_conf, key, frappe.conf.get(key))
		self.addCleanup(frappe.cache.delete_value, "allowed_referrers")
		self.addCleanup(frappe.clear_messages)
		self.addCleanup(frappe.flags.pop, "disable_traceback", None)
		self.addCleanup(frappe.flags.pop, "deferred_csrf_rejection", None)
		self.addCleanup(frappe.flags.pop, "explicitly_authenticated_user", None)

		frappe.flags.pop("deferred_csrf_rejection", None)
		frappe.flags.pop("explicitly_authenticated_user", None)

		frappe.conf.ignore_csrf = None
		frappe.conf.allow_cors = None
		frappe.conf.allowed_referrers = []
		frappe.cache.delete_value("allowed_referrers")

	@staticmethod
	def restore_request_context(request, session, form_dict, session_obj):
		frappe.local.request = request
		frappe.local.session = session
		frappe.local.form_dict = form_dict
		frappe.local.session_obj = session_obj

	@staticmethod
	def restore_conf(key, value):
		if value is None:
			frappe.conf.pop(key, None)
		else:
			frappe.conf[key] = value

	def validate(
		self,
		*,
		method: str = "POST",
		headers: dict | None = None,
		session_token: str | None = None,
		user: str = "Administrator",
		sid_cookie: bool = True,
		sid_in_request: bool = False,
		form_dict: dict | None = None,
		authorization: str | None = None,
	) -> HTTPRequest:
		"""Run `validate_csrf_token` against a synthesised request, session and form dict.

		`session_token` is the CSRF token the session holds, `None` synthesising a session created
		before tokens were minted at login. `sid_in_request` synthesises a session identified by an
		`sid` in the body or query string rather than by the cookie. `authorization` is the value of
		the request's `Authorization` header, `None` sending no such header. The per-request
		`deferred_csrf_rejection` flag is cleared before validation runs, and the `HTTPRequest` the
		validation ran on is returned.
		"""
		request_headers = dict(headers or {})
		if sid_cookie:
			request_headers.setdefault("Cookie", "sid=a-session-id")
		if authorization:
			request_headers.setdefault("Authorization", authorization)

		set_request(
			path="/api/resource/ToDo",
			base_url=self.SITE_ORIGIN,
			method=method,
			headers=request_headers,
		)
		frappe.local.session = frappe._dict(user=user, data=frappe._dict(csrf_token=session_token))
		frappe.local.session_obj = frappe._dict(sid_from_request_parameter=sid_in_request)
		frappe.local.form_dict = frappe._dict(form_dict or {})
		frappe.flags.pop("deferred_csrf_rejection", None)

		http_request = HTTPRequest.__new__(HTTPRequest)
		HTTPRequest.validate_csrf_token(http_request)

		return http_request

	def assertRejected(self, **kwargs) -> None:
		with self.assertRaises(frappe.CSRFTokenError):
			self.validate(**kwargs)

	def test_cross_site_origin_rejected_when_session_has_no_token(self):
		self.assertRejected(headers={"Origin": self.FOREIGN_ORIGIN})

	def test_every_unsafe_method_rejected_cross_site_when_session_has_no_token(self):
		for method in ("POST", "PUT", "DELETE", "PATCH"):
			with self.subTest(method=method):
				self.assertRejected(method=method, headers={"Origin": self.FOREIGN_ORIGIN})

	def test_cross_site_fetch_metadata_rejected_when_session_has_no_token(self):
		for fetch_site in ("cross-site", "same-site"):
			with self.subTest(fetch_site=fetch_site):
				self.assertRejected(headers={"Sec-Fetch-Site": fetch_site})

	def test_foreign_referrer_rejected_when_session_has_no_token(self):
		self.assertRejected(headers={"Referer": f"{self.FOREIGN_ORIGIN}/attack.html"})

	def test_opaque_origin_rejected_when_session_has_no_token(self):
		self.assertRejected(headers={"Origin": "null"})

	def test_same_origin_request_allowed_when_session_has_no_token(self):
		self.validate(headers={"Origin": self.SITE_ORIGIN})
		self.validate(headers={"Origin": self.SITE_ORIGIN, "Sec-Fetch-Site": "same-origin"})
		self.validate(headers={"Referer": f"{self.SITE_ORIGIN}/desk/todo"})
		self.validate(headers={"Sec-Fetch-Site": "none"})

	def test_configured_host_name_counts_as_same_origin(self):
		self.addCleanup(self.restore_conf, "host_name", frappe.conf.get("host_name"))
		frappe.conf.host_name = "https://portal.example.com"

		self.validate(headers={"Origin": "https://portal.example.com"})
		self.assertRejected(headers={"Origin": "https://portal.example.net"})

	def test_same_host_on_another_port_rejected_when_session_has_no_token(self):
		self.assertRejected(headers={"Origin": f"http://{self.SITE_HOST}:8080"})
		self.assertRejected(headers={"Referer": f"http://{self.SITE_HOST}:8080/attack.html"})
		self.assertRejected(headers={"Origin": f"http://{self.SITE_HOST}:0"})

	def test_same_host_on_another_scheme_rejected_when_session_has_no_token(self):
		self.assertRejected(headers={"Origin": f"https://{self.SITE_HOST}"})

	def test_explicit_default_port_counts_as_same_origin(self):
		self.validate(headers={"Origin": f"http://{self.SITE_HOST}:80"})

	def test_configured_host_name_with_a_port_is_matched_on_that_port(self):
		self.addCleanup(self.restore_conf, "host_name", frappe.conf.get("host_name"))
		frappe.conf.host_name = "http://portal.example.com:8080"

		self.validate(headers={"Origin": "http://portal.example.com:8080"})
		self.assertRejected(headers={"Origin": "http://portal.example.com"})
		self.assertRejected(headers={"Origin": "http://portal.example.com:9090"})

	def test_forwarded_https_scheme_defines_the_sites_own_origin(self):
		"""`X-Forwarded-Proto: https` makes the https origin of the request host this site's own."""
		self.validate(headers={"X-Forwarded-Proto": "https", "Origin": f"https://{self.SITE_HOST}"})
		self.assertRejected(headers={"X-Forwarded-Proto": "https", "Origin": f"http://{self.SITE_HOST}"})

	def test_request_without_browser_origin_rejected_when_session_has_no_token(self):
		"""A non-browser client on a token-less cookie session carries no same-site evidence."""
		self.assertRejected()

	def test_token_less_session_requires_positive_same_site_evidence(self):
		self.validate(headers={"Sec-Fetch-Site": "same-origin"})
		self.validate(headers={"Origin": self.SITE_ORIGIN})
		self.validate(headers={"Referer": f"{self.SITE_ORIGIN}/desk/todo"})

		self.assertRejected(headers={})
		self.assertRejected(headers={"Sec-Fetch-Site": "cross-site", "Origin": self.SITE_ORIGIN})

	def test_sid_in_form_dict_without_cookie_is_not_subject_to_csrf(self):
		"""An `sid` supplied in the body or query string is not an ambient cookie credential."""
		self.validate(
			sid_cookie=False,
			sid_in_request=True,
			form_dict={"sid": "a-session-id"},
			headers={"Origin": self.FOREIGN_ORIGIN},
		)

		# the cookie a previous response left behind does not make such a request ambient
		self.validate(
			sid_in_request=True,
			form_dict={"sid": "a-session-id"},
			headers={"Origin": self.FOREIGN_ORIGIN},
		)
		self.validate(
			sid_in_request=True,
			session_token=self.SESSION_TOKEN,
			form_dict={"sid": "a-session-id"},
			headers={"Origin": self.FOREIGN_ORIGIN},
		)

	def test_guest_session_allowed_when_session_has_no_token(self):
		self.validate(user="Guest", headers={"Origin": self.FOREIGN_ORIGIN})

	def test_request_without_session_cookie_allowed_when_session_has_no_token(self):
		self.validate(sid_cookie=False, headers={"Origin": self.FOREIGN_ORIGIN})

	def test_allowed_referrers_conf_allows_cross_site_request_without_token(self):
		frappe.conf.allowed_referrers = [self.FOREIGN_ORIGIN]
		frappe.cache.delete_value("allowed_referrers")

		self.validate(headers={"Origin": self.FOREIGN_ORIGIN})
		self.validate(headers={"Referer": f"{self.FOREIGN_ORIGIN}/embedded.html"})

	def test_allow_cors_conf_allows_cross_site_request_without_token(self):
		"""An explicitly configured origin is an allow-list; the wildcard `"*"` is not."""
		for allow_cors in (self.FOREIGN_ORIGIN, [self.FOREIGN_ORIGIN, "http://other.example"]):
			with self.subTest(allow_cors=allow_cors):
				frappe.conf.allow_cors = allow_cors
				self.validate(headers={"Origin": self.FOREIGN_ORIGIN})

		frappe.conf.allow_cors = ["http://other.example"]
		self.assertRejected(headers={"Origin": self.FOREIGN_ORIGIN})

		frappe.conf.allow_cors = "*"
		self.assertRejected(headers={"Origin": self.FOREIGN_ORIGIN})
		self.assertRejected()

	def test_safe_methods_are_never_validated(self):
		for method in ("GET", "HEAD", "OPTIONS", "QUERY"):
			with self.subTest(method=method):
				self.validate(method=method, headers={"Origin": self.FOREIGN_ORIGIN})
				self.validate(
					method=method,
					headers={"Origin": self.FOREIGN_ORIGIN},
					session_token=self.SESSION_TOKEN,
				)

	def test_ignore_csrf_conf_skips_validation(self):
		frappe.conf.ignore_csrf = 1

		self.validate(headers={"Origin": self.FOREIGN_ORIGIN})
		self.validate(headers={"Origin": self.FOREIGN_ORIGIN}, session_token=self.SESSION_TOKEN)

	def test_session_with_token_requires_a_matching_token(self):
		self.assertRejected(session_token=self.SESSION_TOKEN)
		self.assertRejected(session_token=self.SESSION_TOKEN, headers={"Origin": self.SITE_ORIGIN})
		self.assertRejected(
			session_token=self.SESSION_TOKEN, headers={"X-Frappe-CSRF-Token": "a-wrong-token"}
		)

	def test_session_with_token_accepts_a_matching_token(self):
		self.validate(
			session_token=self.SESSION_TOKEN,
			headers={"X-Frappe-CSRF-Token": self.SESSION_TOKEN, "Origin": self.FOREIGN_ORIGIN},
		)

		self.validate(session_token=self.SESSION_TOKEN, form_dict={"csrf_token": self.SESSION_TOKEN})
		self.assertNotIn("csrf_token", frappe.local.form_dict)

	def test_supplied_token_is_removed_from_the_form_dict(self):
		self.assertRejected(form_dict={"csrf_token": "a-token-for-a-token-less-session"})
		self.assertNotIn("csrf_token", frappe.local.form_dict)

		self.validate(
			headers={"Sec-Fetch-Site": "same-origin"},
			form_dict={"csrf_token": "a-token-for-a-token-less-session"},
		)
		self.assertNotIn("csrf_token", frappe.local.form_dict)

	def test_supported_authorization_credential_defers_the_rejection(self):
		for authorization in self.SUPPORTED_AUTHORIZATION:
			for headers in ({}, {"Origin": self.FOREIGN_ORIGIN}, {"Sec-Fetch-Site": "cross-site"}):
				with self.subTest(authorization=authorization, headers=headers):
					self.validate(authorization=authorization, headers=headers)
					self.assertTrue(frappe.flags.deferred_csrf_rejection)

	def test_authorization_scheme_is_matched_case_insensitively(self):
		for authorization in self.CASED_AUTHORIZATION:
			with self.subTest(authorization=authorization):
				self.validate(authorization=authorization, headers={"Origin": self.FOREIGN_ORIGIN})
				self.assertTrue(frappe.flags.deferred_csrf_rejection)

	def test_unsupported_authorization_header_is_rejected_without_deferral(self):
		for authorization in self.UNSUPPORTED_AUTHORIZATION:
			with self.subTest(authorization=authorization):
				self.assertRejected(authorization=authorization, headers={"Origin": self.FOREIGN_ORIGIN})
				self.assertFalse(frappe.flags.deferred_csrf_rejection)

	def test_session_holding_a_token_defers_when_a_credential_is_supplied(self):
		authorization = f"token {self.API_KEY_CREDENTIAL}"

		self.validate(session_token=self.SESSION_TOKEN, authorization=authorization)
		self.assertTrue(frappe.flags.deferred_csrf_rejection)

		self.validate(
			session_token=self.SESSION_TOKEN,
			authorization=authorization,
			headers={"X-Frappe-CSRF-Token": "a-wrong-token"},
		)
		self.assertTrue(frappe.flags.deferred_csrf_rejection)

		self.validate(
			session_token=self.SESSION_TOKEN,
			authorization=authorization,
			headers={"X-Frappe-CSRF-Token": self.SESSION_TOKEN},
		)
		self.assertFalse(frappe.flags.deferred_csrf_rejection)

	def test_credential_on_a_session_outside_csrf_defers_nothing(self):
		for outside_csrf in (
			{"user": "Guest"},
			{"sid_cookie": False},
			{"sid_in_request": True, "form_dict": {"sid": "a-session-id"}},
		):
			for authorization in self.SUPPORTED_AUTHORIZATION:
				with self.subTest(outside_csrf=outside_csrf, authorization=authorization):
					self.validate(
						authorization=authorization,
						headers={"Origin": self.FOREIGN_ORIGIN},
						**outside_csrf,
					)
					self.assertFalse(frappe.flags.deferred_csrf_rejection)

	def test_supported_credential_makes_a_cookie_session_non_ambient(self):
		http_request = self.validate(headers={"Origin": self.SITE_ORIGIN})
		self.assertTrue(http_request.is_cookie_session())
		self.assertTrue(http_request.is_ambient_cookie_session())

		for authorization in self.SUPPORTED_AUTHORIZATION + self.CASED_AUTHORIZATION:
			with self.subTest(authorization=authorization):
				http_request = self.validate(
					authorization=authorization, headers={"Origin": self.SITE_ORIGIN}
				)
				self.assertTrue(http_request.is_cookie_session())
				self.assertFalse(http_request.is_ambient_cookie_session())

		for authorization in self.UNSUPPORTED_AUTHORIZATION:
			with self.subTest(authorization=authorization):
				http_request = self.validate(
					authorization=authorization, headers={"Origin": self.SITE_ORIGIN}
				)
				self.assertTrue(http_request.is_cookie_session())
				self.assertTrue(http_request.is_ambient_cookie_session())

	def test_deferred_rejection_is_applied_when_the_credential_did_not_authenticate(self):
		self.validate(authorization=f"token {self.API_KEY_CREDENTIAL}")
		self.assertTrue(frappe.flags.deferred_csrf_rejection)

		with self.assertRaises(frappe.CSRFTokenError):
			validate_deferred_csrf_rejection()

		self.assertFalse(frappe.flags.deferred_csrf_rejection)

	def test_deferred_rejection_is_dropped_when_the_credential_authenticated(self):
		self.validate(authorization=f"Bearer {self.BEARER_CREDENTIAL}")
		self.assertTrue(frappe.flags.deferred_csrf_rejection)

		frappe.flags.explicitly_authenticated_user = "Administrator"
		validate_deferred_csrf_rejection()

		self.assertFalse(frappe.flags.deferred_csrf_rejection)

	def test_deferred_rejection_is_applied_when_the_credential_authenticated_another_user(self):
		self.validate(authorization=f"token {self.API_KEY_CREDENTIAL}", user="Administrator")
		self.assertTrue(frappe.flags.deferred_csrf_rejection)

		frappe.flags.explicitly_authenticated_user = "test2@example.com"
		with self.assertRaises(frappe.CSRFTokenError):
			validate_deferred_csrf_rejection()

		self.assertFalse(frappe.flags.deferred_csrf_rejection)

	def test_validate_deferred_csrf_rejection_without_a_deferral_does_nothing(self):
		validate_deferred_csrf_rejection()
		self.assertFalse(frappe.flags.deferred_csrf_rejection)

		frappe.flags.explicitly_authenticated_user = "Administrator"
		validate_deferred_csrf_rejection()
		self.assertFalse(frappe.flags.deferred_csrf_rejection)


class TestLoginMintsCSRFToken(IntegrationTestCase):
	"""Cover the CSRF token that `POST /api/method/login` mints, stores and returns."""

	def test_api_login_mints_stores_and_returns_a_csrf_token(self):
		self.addCleanup(
			self.restore_login_context,
			getattr(frappe.local, "request", None),
			getattr(frappe.local, "session", None),
			getattr(frappe.local, "session_obj", None),
			getattr(frappe.local, "login_manager", None),
			getattr(frappe.local, "cookie_manager", None),
			getattr(frappe.local, "request_ip", None),
			frappe.local.response,
			dict(frappe.local.form_dict),
		)

		set_request(path="/api/method/login", method="POST", base_url=get_site_url(frappe.local.site))
		frappe.local.response = frappe._dict()
		frappe.local.form_dict = frappe._dict(usr="Administrator", pwd=frappe.conf.admin_password or "admin")

		# the whole request path: the login creates the session, then CSRF validation runs on it
		HTTPRequest()
		sid = frappe.session.sid
		self.addCleanup(self.delete_session_record, sid)

		token = frappe.session.data.csrf_token
		self.assertIsInstance(token, str)
		self.assertTrue(token)
		self.assertEqual(frappe.local.response["csrf_token"], token)

		Sessions = frappe.qb.DocType("Sessions")
		stored = (frappe.qb.from_(Sessions).select(Sessions.sessiondata).where(Sessions.sid == sid)).run()[0][
			0
		]
		self.assertEqual(frappe.parse_json(stored).csrf_token, token)
		self.assertEqual(frappe.sessions.get_csrf_token(), token)

	@staticmethod
	def restore_login_context(
		request, session, session_obj, login_manager, cookie_manager, request_ip, response, form_dict
	):
		frappe.local.request = request
		frappe.local.session = session
		frappe.local.session_obj = session_obj
		frappe.local.login_manager = login_manager
		frappe.local.cookie_manager = cookie_manager
		frappe.local.request_ip = request_ip
		frappe.local.response = response
		frappe.local.form_dict = frappe._dict(form_dict)

	@staticmethod
	def delete_session_record(sid: str) -> None:
		frappe.db.delete("Sessions", {"sid": sid})
		frappe.db.commit()  # nosemgrep: frappe-manual-commit
		frappe.cache.hdel("session", sid)


class TestExplicitCredentialCSRF(FrappeAPITestCase):
	"""Cover the CSRF outcome of an unsafe request that carries a logged-in `sid` cookie together with
	an `Authorization` header, through the whole `frappe.app.application` pipeline."""

	PROBE_DESCRIPTION = "explicit credential csrf probe"
	OAUTH_CLIENT_NAME = "_Test CSRF OAuth Client"
	OTHER_USER = "_test_csrf_other_user@example.com"

	def setUp(self):
		super().setUp()
		self.todo = frappe.get_doc(doctype="ToDo", description=self.PROBE_DESCRIPTION).insert()
		frappe.db.commit()  # nosemgrep: frappe-manual-commit
		self.addCleanup(self.delete_todos, self.todo.name)

	@cached_property
	def cookie_client(self):
		"""A client that keeps no cookie jar, so every request carries only the cookies it is given."""
		return get_test_client(use_cookies=False)

	@cached_property
	def cookie_sid(self) -> str:
		"""Return the `sid` of a logged-in Administrator cookie session, dropped when the test ends."""
		sid = self.sid
		self.addCleanup(self.delete_session_record, sid)

		return sid

	@cached_property
	def api_credentials(self) -> tuple[str, str]:
		"""Return Administrator's `api_key` and `api_secret`, both restored when the test ends."""
		previous_key = frappe.db.get_value("User", "Administrator", "api_key")
		previous_secret = get_decrypted_password("User", "Administrator", "api_secret", raise_exception=False)
		self.addCleanup(self.restore_api_credentials, previous_key, previous_secret)

		generate_keys("Administrator")
		frappe.db.commit()  # nosemgrep: frappe-manual-commit

		return (
			frappe.db.get_value("User", "Administrator", "api_key"),
			get_decrypted_password("User", "Administrator", "api_secret"),
		)

	@cached_property
	def other_user_credentials(self) -> tuple[str, str]:
		"""Return the `api_key` and `api_secret` of a user other than the cookie session's user."""
		user = frappe.get_doc(
			doctype="User",
			email=self.OTHER_USER,
			first_name="CSRF",
			last_name="Other User",
			send_welcome_email=0,
		).insert()
		self.addCleanup(self.delete_user, user.name)

		keys = generate_keys(user.name)
		frappe.db.commit()  # nosemgrep: frappe-manual-commit

		return keys["api_key"], keys["api_secret"]

	@staticmethod
	def delete_user(user: str) -> None:
		frappe.db.rollback()
		frappe.delete_doc_if_exists("User", user, force=True)
		frappe.db.commit()  # nosemgrep: frappe-manual-commit

	@cached_property
	def oauth_bearer_token(self) -> str:
		"""Return the access token of an active OAuth Bearer Token, dropped when the test ends."""
		client = frappe.get_doc(
			doctype="OAuth Client",
			name=self.OAUTH_CLIENT_NAME,
			app_name=self.OAUTH_CLIENT_NAME,
			client_secret="a-test-client-secret",
			default_redirect_uri="http://localhost",
			redirect_uris="http://localhost",
			grant_type="Authorization Code",
			response_type="Code",
			scopes="all",
			skip_authorization=1,
		).insert()
		self.addCleanup(self.delete_oauth_fixtures, client.name)

		access_token = frappe.generate_hash(length=30)
		frappe.get_doc(
			doctype="OAuth Bearer Token",
			client=client.name,
			user="Administrator",
			scopes="all",
			access_token=access_token,
			refresh_token=frappe.generate_hash(length=30),
			expires_in=3600,
			status="Active",
		).insert(ignore_permissions=True)
		frappe.db.commit()  # nosemgrep: frappe-manual-commit

		return access_token

	@staticmethod
	def delete_oauth_fixtures(client: str) -> None:
		frappe.db.rollback()
		for token in frappe.get_all("OAuth Bearer Token", filters={"client": client}, pluck="name"):
			frappe.delete_doc_if_exists("OAuth Bearer Token", token, force=True)
		frappe.delete_doc_if_exists("OAuth Client", client, force=True)
		frappe.db.commit()  # nosemgrep: frappe-manual-commit

	@staticmethod
	def restore_api_credentials(api_key: str | None, api_secret: str | None) -> None:
		if api_secret:
			set_encrypted_password("User", "Administrator", api_secret, "api_secret")
		else:
			remove_encrypted_password("User", "Administrator", "api_secret")

		frappe.db.set_value("User", "Administrator", "api_key", api_key, update_modified=False)
		frappe.db.commit()  # nosemgrep: frappe-manual-commit

	@staticmethod
	def delete_session_record(sid: str) -> None:
		frappe.db.delete("Sessions", {"sid": sid})
		frappe.db.commit()  # nosemgrep: frappe-manual-commit
		frappe.cache.hdel("session", sid)

	@staticmethod
	def delete_todos(*names: str) -> None:
		frappe.db.rollback()
		for name in names:
			frappe.delete_doc_if_exists("ToDo", name, force=True)
		frappe.db.commit()  # nosemgrep: frappe-manual-commit

	def cookie_request(self, method: str, path: str, data: dict, headers: dict | None = None):
		"""Send `data` to `path` with this test's `sid` cookie and no CSRF token."""
		return make_request(
			target=getattr(self.cookie_client, method),
			args=(path,),
			kwargs={"json": data, "headers": {"Cookie": f"sid={self.cookie_sid}", **(headers or {})}},
		)

	def stored_description(self) -> str:
		frappe.db.rollback()

		return frappe.db.get_value("ToDo", self.todo.name, "description")

	def test_api_key_credential_updates_a_document_without_a_csrf_token(self):
		api_key, api_secret = self.api_credentials

		for authorization in (
			f"token {api_key}:{api_secret}",
			"Basic {}".format(base64.b64encode(frappe.safe_encode(f"{api_key}:{api_secret}")).decode()),
		):
			with self.subTest(scheme=authorization.split(" ", 1)[0]):
				description = f"updated with {authorization.split(' ', 1)[0]} credentials"
				response = self.cookie_request(
					"put",
					self.resource("ToDo", self.todo.name),
					{"description": description},
					{"Authorization": authorization},
				)

				self.assertEqual(response.status_code, 200)
				self.assertEqual(self.stored_description(), description)

	def test_api_key_credential_creates_a_document_without_a_csrf_token(self):
		api_key, api_secret = self.api_credentials
		description = "created with token credentials"

		response = self.cookie_request(
			"post",
			self.resource("ToDo"),
			{"description": description},
			{"Authorization": f"token {api_key}:{api_secret}"},
		)

		self.assertEqual(response.status_code, 200)
		frappe.db.rollback()
		created = frappe.get_all("ToDo", filters={"description": description}, pluck="name")
		self.addCleanup(self.delete_todos, *created)
		self.assertEqual(len(created), 1)

	def test_oauth_bearer_credential_updates_a_document_without_a_csrf_token(self):
		description = "updated with an oauth bearer token"

		response = self.cookie_request(
			"put",
			self.resource("ToDo", self.todo.name),
			{"description": description},
			{"Authorization": f"Bearer {self.oauth_bearer_token}"},
		)

		self.assertEqual(response.status_code, 200)
		self.assertEqual(self.stored_description(), description)

	def test_rejected_credential_never_reaches_the_before_request_stage(self):
		other_key, other_secret = self.other_user_credentials
		api_key, api_secret = self.api_credentials

		for authorization, status_code in (
			("Bearer notatoken", 400),
			(f"token {other_key}:{other_secret}", 400),
			("token an-unknown-api-key:an-unknown-api-secret", 401),
		):
			with self.subTest(authorization=authorization):
				response = self.recorded_cookie_request(authorization, "rejected before the hooks")

				self.assertEqual(response.status_code, status_code)
				self.assertEqual(BEFORE_REQUEST_CALLS, [])
				self.assertEqual(self.stored_description(), self.PROBE_DESCRIPTION)

		description = "accepted after authentication"
		response = self.recorded_cookie_request(f"token {api_key}:{api_secret}", description)

		self.assertEqual(response.status_code, 200)
		self.assertEqual(BEFORE_REQUEST_CALLS, [("Administrator", f"token {api_key}:{api_secret}")])
		self.assertEqual(self.stored_description(), description)

	def recorded_cookie_request(self, authorization: str, description: str):
		"""Send an unsafe cookie-session request with `record_before_request` as the only
		`before_request` hook, having emptied `BEFORE_REQUEST_CALLS`."""
		BEFORE_REQUEST_CALLS.clear()
		self.addCleanup(BEFORE_REQUEST_CALLS.clear)

		with self.patch_hooks({"before_request": ["frappe.tests.test_auth.record_before_request"]}):
			return self.cookie_request(
				"put",
				self.resource("ToDo", self.todo.name),
				{"description": description},
				{"Authorization": authorization},
			)

	def test_credential_of_another_user_with_a_cookie_session_is_rejected(self):
		api_key, api_secret = self.other_user_credentials

		response = self.cookie_request(
			"put",
			self.resource("ToDo", self.todo.name),
			{"description": "forged with another user's api key"},
			{"Authorization": f"token {api_key}:{api_secret}"},
		)

		self.assertEqual(response.status_code, 400)
		self.assertEqual(response.json.get("exc_type"), "CSRFTokenError")
		self.assertEqual(self.stored_description(), self.PROBE_DESCRIPTION)

	def test_unauthenticated_credential_with_a_cookie_session_is_rejected(self):
		response = self.cookie_request(
			"put",
			self.resource("ToDo", self.todo.name),
			{"description": "forged with a bearer token"},
			{"Authorization": "Bearer notatoken"},
		)

		self.assertEqual(response.status_code, 400)
		self.assertEqual(response.json.get("exc_type"), "CSRFTokenError")
		self.assertEqual(self.stored_description(), self.PROBE_DESCRIPTION)

	def test_cookie_session_without_a_credential_is_rejected(self):
		response = self.cookie_request(
			"put",
			self.resource("ToDo", self.todo.name),
			{"description": "updated with no credential at all"},
		)

		self.assertEqual(response.status_code, 400)
		self.assertEqual(response.json.get("exc_type"), "CSRFTokenError")
		self.assertEqual(self.stored_description(), self.PROBE_DESCRIPTION)


class TestHostname(UnitTestCase):
	def test_get_hostname_normalizes_urls_origins_and_hosts(self):
		self.assertEqual(get_hostname("http://example.com/desk/todo"), "example.com")
		self.assertEqual(get_hostname("https://Example.COM"), "example.com")
		self.assertEqual(get_hostname("https://www.example.com:8000"), "example.com")
		self.assertEqual(get_hostname("example.com:8000"), "example.com")
		self.assertEqual(get_hostname("null"), "null")

	def test_get_hostname_returns_empty_string_for_unusable_input(self):
		self.assertEqual(get_hostname(""), "")
		self.assertEqual(get_hostname(None), "")
		self.assertEqual(get_hostname("http://["), "")

	def test_get_origin_normalizes_scheme_hostname_and_port(self):
		self.assertEqual(get_origin("https://Example.COM/x"), ("https", "example.com", "443"))
		self.assertEqual(get_origin("http://example.com"), ("http", "example.com", "80"))
		self.assertEqual(get_origin("https://www.example.com:8443"), ("https", "example.com", "8443"))
		self.assertEqual(get_origin("http://example.com:0"), ("http", "example.com", "0"))

	def test_get_origin_completes_omitted_components_from_its_arguments(self):
		self.assertEqual(
			get_origin("example.com", scheme="https", port="8443"), ("https", "example.com", "8443")
		)
		self.assertEqual(
			get_origin("example.com:9000", scheme="http", port="80"), ("http", "example.com", "9000")
		)
		self.assertEqual(
			get_origin("https://example.com", scheme="http", port="8200"), ("https", "example.com", "443")
		)
		self.assertEqual(
			get_origin("example.com:0", scheme="http", port="8200"), ("http", "example.com", "0")
		)

	def test_get_origin_returns_none_for_unusable_input(self):
		for url in (None, "", "http://[", "/desk/todo", "http://example.com:99999"):
			with self.subTest(url=url):
				self.assertIsNone(get_origin(url))
