# Copyright (c) 2015, Frappe Technologies Pvt. Ltd. and Contributors
# License: MIT. See LICENSE

import functools
import logging
import os
import sys

import orjson
from werkzeug.exceptions import HTTPException, NotFound
from werkzeug.middleware.profiler import ProfilerMiddleware
from werkzeug.middleware.proxy_fix import ProxyFix
from werkzeug.middleware.shared_data import SharedDataMiddleware
from werkzeug.wrappers import Request, Response  # nosemgrep: frappe-monkey-patching-not-allowed
from werkzeug.wsgi import ClosingIterator

import frappe
import frappe.api
import frappe.handler
import frappe.monitor
import frappe.rate_limiter
import frappe.recorder
import frappe.utils.response
from frappe import _
from frappe.auth import SAFE_HTTP_METHODS, UNSAFE_HTTP_METHODS, HTTPRequest, check_request_ip, validate_auth
from frappe.integrations.oauth2 import get_resource_url, handle_wellknown, is_oauth_metadata_enabled
from frappe.middlewares import StaticDataMiddleware
from frappe.permissions import handle_does_not_exist_error
from frappe.utils import CallbackManager, cint, get_site_name
from frappe.utils.data import escape_html
from frappe.utils.error import log_error, log_error_snapshot
from frappe.website.page_renderers.error_page import ErrorPage
from frappe.website.serve import get_response

_site = None
_sites_path = os.environ.get("SITES_PATH", ".")


# If gc.freeze is done then importing modules before forking allows us to share the memory
import gettext

import babel
import babel.messages
import nh3
import num2words
import pydantic

import frappe.boot
import frappe.client
import frappe.core.doctype.file.file
import frappe.core.doctype.user.user

# Skipped under the companion manager: the gevent socketio companion forks this
# master and refuses to start if MySQLdb is already imported. Loaded lazily there.
if not os.environ.get("FRAPPE_GUNICORN_COMPANION"):
	import frappe.database.mariadb.mysqlclient  # Load database related utils
import frappe.database.query
import frappe.desk.desktop  # workspace
import frappe.desk.form.save
import frappe.model.db_query
import frappe.query_builder
import frappe.utils.background_jobs  # Enqueue is very common
import frappe.utils.data  # common utils
import frappe.utils.jinja  # web page rendering
import frappe.utils.jinja_globals
import frappe.utils.redis_wrapper  # Exact redis_wrapper
import frappe.utils.safe_exec
import frappe.utils.typing_validations  # any whitelisted method uses this
import frappe.website.path_resolver  # all the page types and resolver
import frappe.website.router  # Website router
import frappe.website.website_generator  # web page doctypes

# end: module pre-loading

# better werkzeug default
# this is necessary because frappe desk sends most requests as form data
# and some of them can exceed werkzeug's default limit of 500kb
Request.max_form_memory_size = None  # nosemgrep: frappe-monkey-patching-not-allowed


def after_response_wrapper(app):
	"""Wrap a WSGI application to call after_response hooks after we have responded.

	This is done to reduce response time by deferring expensive tasks."""

	@functools.wraps(app)
	def application(environ, start_response):
		return ClosingIterator(
			app(environ, start_response),
			(
				frappe.rate_limiter.update,
				frappe.recorder.dump,
				frappe.request.after_response.run,
				frappe.destroy,
			),
		)

	return application


@after_response_wrapper
@Request.application
def application(request: Request):
	response = None

	try:
		init_request(request)

		validate_auth()

		if request.method == "OPTIONS":
			response = Response()

		elif frappe.form_dict.cmd:
			from frappe.deprecation_dumpster import deprecation_warning

			deprecation_warning(
				"unknown",
				"v17",
				f"{frappe.form_dict.cmd}: Sending `cmd` for RPC calls is deprecated, call REST API instead `/api/method/cmd`",
			)
			frappe.handler.handle()
			response = frappe.utils.response.build_response("json")

		elif request.path.startswith("/api/"):
			response = frappe.api.handle(request)

		elif request.path.startswith("/backups"):
			response = frappe.utils.response.download_backup(request.path)

		elif request.path.startswith("/private/files/"):
			response = frappe.utils.response.download_private_file(request.path)

		elif request.path == "/.well-known/security.txt" and request.method == "GET":
			if request.scheme != "https":
				raise NotFound
			security_settings = frappe.get_doc("Security Settings")
			response = Response(security_settings.security_txt, content_type="text/plain")

		elif request.path.startswith("/.well-known/") and request.method == "GET":
			response = handle_wellknown(request.path)

		elif request.method in ("GET", "HEAD", "POST"):
			response = get_response()

		else:
			raise NotFound

	except Exception as e:
		response = e.get_response(request.environ) if isinstance(e, HTTPException) else handle_exception(e)
		if db := getattr(frappe.local, "db", None):
			db.rollback(chain=True)

	else:
		sync_database()

	finally:
		# Important note:
		# this function *must* always return a response, hence any exception thrown outside of
		# try..catch block like this finally block needs to be handled appropriately.

		try:
			run_after_request_hooks(request, response)
		except Exception:
			# We can not handle exceptions safely here.
			frappe.logger().error("Failed to run after request hook", exc_info=True)

	log_request(request, response)
	process_response(response)

	return response


def run_after_request_hooks(request, response):
	if not getattr(frappe.local, "initialised", False):
		return

	for after_request_task in frappe.get_hooks("after_request"):
		frappe.call(after_request_task, response=response, request=request)


def init_request(request):
	site = _site or request.headers.get("X-Frappe-Site-Name") or get_site_name(request.host)
	try:
		frappe.init(site, sites_path=_sites_path, force=True, is_request=True)
	finally:
		frappe.local.request = request
		request.after_response = CallbackManager()

	assert frappe.local.conf and frappe.local.conf.db_name, "config should be loaded"

	frappe.local.is_ajax = request.headers.get("X-Requested-With") == "XMLHttpRequest"

	frappe.connect(set_admin_as_user=False)
	if frappe.local.conf.maintenance_mode:
		if frappe.local.conf.allow_reads_during_maintenance:
			setup_read_only_mode()
		else:
			raise frappe.SessionStopped("Session Stopped")

	if request.path.startswith("/api/method/upload_file"):
		from frappe.core.api.file import get_max_file_size

		request.max_content_length = get_max_file_size()
	else:
		request.max_content_length = cint(frappe.local.conf.get("max_file_size")) or 25 * 1024 * 1024
	make_form_dict(request)

	if request.method != "OPTIONS":
		frappe.local.http_request = HTTPRequest()

		# a CSRF rejection deferred to explicit authentication is settled before any hook runs
		if frappe.flags.deferred_csrf_rejection:
			validate_auth()

	for before_request_task in frappe.get_hooks("before_request"):
		frappe.call(before_request_task)


def setup_read_only_mode():
	"""During maintenance_mode reads to DB can still be performed to reduce downtime. This
	function sets up read only mode

	- Setting global flag so other pages, desk and database can know that we are in read only mode.
	- Setup read only database access either by:
	    - Connecting to read replica if one exists
	    - Or setting up read only SQL transactions.
	"""
	frappe.flags.read_only = True

	# If replica is available then just connect replica, else setup read only transaction.
	if frappe.conf.read_from_replica:
		frappe.connect_replica()
	else:
		frappe.db.begin(read_only=True)


def log_request(request, response):
	if hasattr(frappe.local, "conf") and frappe.local.conf.enable_frappe_logger:
		frappe.logger("frappe.web", allow_site=frappe.local.site).info(
			{
				"site": get_site_name(request.host),
				"remote_addr": getattr(request, "remote_addr", "NOTFOUND"),
				"pid": os.getpid(),
				"user": getattr(frappe.local.session, "user", "NOTFOUND"),
				"base_url": getattr(request, "base_url", "NOTFOUND"),
				"full_path": getattr(request, "full_path", "NOTFOUND"),
				"method": getattr(request, "method", "NOTFOUND"),
				"scheme": getattr(request, "scheme", "NOTFOUND"),
				"http_status_code": getattr(response, "status_code", "NOTFOUND"),
			}
		)


NO_CACHE_HEADERS = {"Cache-Control": "no-store,no-cache,must-revalidate,max-age=0"}

# Baseline security response headers applied to every dynamic response.
DEFAULT_X_FRAME_OPTIONS = "SAMEORIGIN"
DEFAULT_X_CONTENT_TYPE_OPTIONS = "nosniff"
DEFAULT_REFERRER_POLICY = "strict-origin-when-cross-origin"
DEFAULT_CONTENT_SECURITY_POLICY = (
	"default-src 'self'; "
	"script-src 'self' 'unsafe-inline' 'unsafe-eval' https:; "
	"style-src 'self' 'unsafe-inline' https:; "
	"img-src 'self' data: blob: https:; "
	"font-src 'self' data: https:; "
	"connect-src 'self' ws: wss: https:; "
	"frame-src 'self' blob: https:; "
	"media-src 'self' data: blob: https:; "
	"worker-src 'self' blob:; "
	"object-src 'none'; "
	"base-uri 'self'; "
	"frame-ancestors 'self'"
)

# Ports a URL scheme implies when a CSP host source omits one.
DEFAULT_SCHEME_PORTS = {"http": "80", "https": "443", "ws": "80", "wss": "443"}

# Site config key -> (header name, default value). An empty configured value omits the header.
SECURITY_HEADER_CONFIG_KEYS = {
	"x_frame_options": ("X-Frame-Options", DEFAULT_X_FRAME_OPTIONS),
	"content_security_policy": ("Content-Security-Policy", DEFAULT_CONTENT_SECURITY_POLICY),
	"x_content_type_options": ("X-Content-Type-Options", DEFAULT_X_CONTENT_TYPE_OPTIONS),
	"referrer_policy": ("Referrer-Policy", DEFAULT_REFERRER_POLICY),
}


def process_response(response: Response):
	if not response:
		return

	# Default for all requests is no-cache unless explicitly opted-in by endpoint
	response.headers.setdefault("Cache-Control", NO_CACHE_HEADERS["Cache-Control"])

	# rate limiter headers
	if hasattr(frappe.local, "rate_limiter"):
		response.headers.update(frappe.local.rate_limiter.headers())

	if trace_id := frappe.monitor.get_trace_id():
		response.headers.update({"X-Frappe-Request-Id": trace_id})

	# CORS headers
	if hasattr(frappe.local, "conf"):
		set_cors_headers(response)

	if response.status_code in (401, 403) and is_oauth_metadata_enabled("resource"):
		set_authenticate_headers(response)

	# Security headers, applied before the per-request headers are merged
	set_security_headers(response)

	# Update custom headers added during request processing
	response.headers.update(frappe.local.response_headers)

	# Set cookies, only if response is non-cacheable to avoid proxy cache invalidation
	public_cache = any("public" in h for h in response.headers.getlist("Cache-Control"))
	if hasattr(frappe.local, "cookie_manager") and not public_cache:
		frappe.local.cookie_manager.flush_cookies(response=response)

	if frappe._dev_server:
		response.headers.update(NO_CACHE_HEADERS)


def set_cors_headers(response):
	allowed_origins = frappe.conf.allow_cors
	if hasattr(frappe.local, "allow_cors"):
		allowed_origins = frappe.local.allow_cors

	if not (
		allowed_origins and (request := frappe.local.request) and (origin := request.headers.get("Origin"))
	):
		return

	if allowed_origins != "*":
		if not isinstance(allowed_origins, list):
			allowed_origins = [allowed_origins]

		if origin not in allowed_origins:
			return

	cors_headers = {
		"Access-Control-Allow-Credentials": "true",
		"Access-Control-Allow-Origin": origin,
		"Vary": "Origin",
	}

	# only required for preflight requests
	if request.method == "OPTIONS":
		cors_headers["Access-Control-Allow-Methods"] = request.headers.get("Access-Control-Request-Method")

		if allowed_headers := request.headers.get("Access-Control-Request-Headers"):
			cors_headers["Access-Control-Allow-Headers"] = allowed_headers

		# allow browsers to cache preflight requests for upto a day
		if not frappe.conf.developer_mode:
			cors_headers["Access-Control-Max-Age"] = "86400"

	response.headers.update(cors_headers)


def set_security_headers(response: Response):
	"""Add the baseline security headers to `response`.

	Each header is added with `setdefault`, so a header already set on the response - e.g. the
	`frame-ancestors` Content-Security-Policy a Web Form with allowed embedding domains sets - is
	kept as it is. Every header can be overridden per site through the site config keys in
	`SECURITY_HEADER_CONFIG_KEYS`; an empty or null configured value omits that header, and
	`disable_security_headers` omits all of them.

	    # site_config.json
	    {"referrer_policy": "same-origin", "x_frame_options": "DENY"}
	"""
	conf = getattr(frappe.local, "conf", None) or {}

	if cint(conf.get("disable_security_headers")):
		return

	explicit_csp = effective_content_security_policy(response)

	for config_key, (header, default) in SECURITY_HEADER_CONFIG_KEYS.items():
		value = conf[config_key] if config_key in conf else default
		if not value:
			continue

		value = str(value)

		if header == "Content-Security-Policy":
			if explicit_csp:
				continue
			value = add_dev_socketio_source(value)
		elif header == "X-Frame-Options" and explicit_csp and frame_ancestors_allow_other_hosts(explicit_csp):
			# omitted while the effective policy allows framing by other hosts
			continue

		response.headers.setdefault(header, value)


def effective_content_security_policy(response: Response) -> str | None:
	"""Return the Content-Security-Policy `response` carries once the per-request headers are merged.

	A value in `frappe.local.response_headers` takes precedence over one already on the response,
	which is the order `process_response` merges them in; a key present there with an empty value
	resolves to that empty value.
	"""
	request_headers = getattr(frappe.local, "response_headers", None) or {}

	if "Content-Security-Policy" in request_headers:
		return request_headers["Content-Security-Policy"]

	return response.headers.get("Content-Security-Policy")


def frame_ancestors_allow_other_hosts(policy: str) -> bool:
	"""Return whether `policy`'s frame-ancestors directive can match an origin other than this request's."""
	for directive in policy.split(";"):
		sources = directive.split()
		if sources and sources[0].lower() == "frame-ancestors":
			return any(is_other_origin_source(source) for source in sources[1:])

	return False


def is_other_origin_source(source: str) -> bool:
	"""Return whether CSP `source` can match an origin other than the one serving this request.

	`'self'` and `'none'` cannot. A wildcard, a scheme-only source, or a host source naming
	another scheme, host or port can; a host source spelling out the current origin cannot. A
	source resolved outside a request is reported as another origin.
	"""
	token = source.strip("'\"").lower()

	if token in ("self", "none"):
		return False

	if "*" in token or (token.endswith(":") and "//" not in token):
		return True

	request = getattr(frappe.local, "request", None)
	if not request:
		return True

	scheme, separator, authority = token.partition("://")
	if not separator:
		scheme, authority = request.scheme, token

	authority = authority.split("/")[0]

	if not authority:
		return True

	return normalized_origin(scheme, authority) != normalized_origin(request.scheme, request.host)


def normalized_origin(scheme: str, host: str) -> tuple[str, str, str]:
	"""Return (scheme, hostname, port) for `scheme` and `host`, with the scheme's default port filled in."""
	scheme = scheme.lower()

	if host.startswith("["):
		hostname, _, port = host.partition("]")
		hostname, port = f"{hostname}]", port.lstrip(":")
	else:
		hostname, _, port = host.partition(":")

	return scheme, hostname.lower(), port or DEFAULT_SCHEME_PORTS.get(scheme, "")


def add_dev_socketio_source(policy: str) -> str:
	"""Return `policy` with the development server's socketio origin allowed for connections.

	The origin is appended to `connect-src` when that directive is present, and otherwise to a
	`connect-src` synthesized from `default-src`'s sources. A policy that restricts neither
	directive, a policy that already lists the origin, and any policy resolved outside the
	development server are returned unchanged.
	"""
	if not frappe._dev_server:
		return policy

	conf = getattr(frappe.local, "conf", None) or {}
	socketio_port = conf.get("socketio_port")
	request = getattr(frappe.local, "request", None)

	if not (socketio_port and request):
		return policy

	source = f"{request.scheme}://{request.host.split(':')[0]}:{socketio_port}"
	directives = [directive.strip() for directive in policy.split(";") if directive.strip()]
	default_sources = None

	for index, directive in enumerate(directives):
		sources = directive.split()
		name = sources[0].lower()

		if name == "connect-src":
			if source in sources[1:]:
				return policy

			directives[index] = f"{directive} {source}"
			return "; ".join(directives)

		if name == "default-src":
			default_sources = sources[1:]

	if default_sources is None:
		return policy

	fallback = [s for s in default_sources if s.strip("'\"").lower() != "none"]
	directives.append(" ".join(["connect-src", *fallback, source]))

	return "; ".join(directives)


def set_authenticate_headers(response: Response):
	headers = {
		"WWW-Authenticate": f'Bearer resource_metadata="{get_resource_url()}/.well-known/oauth-protected-resource"'
	}
	response.headers.update(headers)


def make_form_dict(request: Request):
	request_data = request.get_data(as_text=True)
	if request_data and request.is_json:
		try:
			args = orjson.loads(request_data)
		except orjson.JSONDecodeError:
			frappe.throw(_("Invalid request body"), frappe.DataError)
	else:
		args = {}
		args.update(request.args or {})
		args.update(request.form or {})

	if isinstance(args, dict):
		frappe.local.form_dict = frappe._dict(args)
		# _ is passed by $.ajax so that the request is not cached by the browser. So, remove _ from form_dict
		frappe.local.form_dict.pop("_", None)
	elif isinstance(args, list):
		frappe.local.form_dict["data"] = args
	else:
		frappe.throw(_("Invalid request arguments"))


@handle_does_not_exist_error
def handle_exception(e):
	response = None
	http_status_code = getattr(e, "http_status_code", 500)
	accept_header = frappe.get_request_header("Accept") or ""
	respond_as_json = (
		frappe.get_request_header("Accept") and (frappe.local.is_ajax or "application/json" in accept_header)
	) or (frappe.local.request.path.startswith("/api/") and not accept_header.startswith("text"))

	if not frappe.session.user:
		# If session creation fails then user won't be unset. This causes a lot of code that
		# assumes presence of this to fail. Session creation fails => guest or expired login
		# usually.
		frappe.session.user = "Guest"

	if respond_as_json:
		# handle ajax responses first
		# if the request is ajax, send back the trace or error message
		response = frappe.utils.response.report_error(http_status_code)

	elif isinstance(e, frappe.SessionStopped):
		response = frappe.utils.response.handle_session_stopped()

	elif (
		http_status_code == 500
		and (frappe.db and isinstance(e, frappe.db.InternalError))
		and (frappe.db and (frappe.db.is_deadlocked(e) or frappe.db.is_timedout(e)))
	):
		http_status_code = 508

	elif http_status_code == 401:
		response = ErrorPage(
			http_status_code=http_status_code,
			title=_("Session Expired"),
			message=_("Your session has expired, please login again to continue."),
		).render()

	elif http_status_code == 403:
		response = ErrorPage(
			http_status_code=http_status_code,
			title=_("Not Permitted"),
			message=_("You do not have enough permissions to complete the action"),
		).render()

	elif http_status_code == 404:
		response = ErrorPage(
			http_status_code=http_status_code,
			title=_("Not Found"),
			message=_("The resource you are looking for is not available"),
		).render()

	elif http_status_code == 429:
		response = frappe.rate_limiter.respond()

	else:
		response = ErrorPage(
			http_status_code=http_status_code, title=_("Server Error"), message=_("Uncaught Exception")
		).render()

	if e.__class__ == frappe.AuthenticationError:
		if hasattr(frappe.local, "login_manager"):
			frappe.local.login_manager.clear_cookies()

	if http_status_code >= 500 or frappe.conf.developer_mode:
		log_error_snapshot(e)

	if frappe.conf.get("developer_mode") and not respond_as_json:
		# don't fail silently for non-json response errors
		print(frappe.get_traceback())

	return response


def sync_database():
	db = getattr(frappe.local, "db", None)
	if not db:
		# db isn't initialized, can't commit or rollback
		return

	# if HTTP method would change server state, commit if necessary
	if frappe.local.request.method in UNSAFE_HTTP_METHODS or frappe.local.flags.commit:
		db.commit(chain=True)
	else:
		db.rollback(chain=True)

	# update session
	if session := getattr(frappe.local, "session_obj", None):
		frappe.request.after_response.add(session.update)


# Always initialize sentry SDK if the DSN is sent
if sentry_dsn := os.getenv("FRAPPE_SENTRY_DSN"):
	import sentry_sdk
	from sentry_sdk.integrations.argv import ArgvIntegration
	from sentry_sdk.integrations.atexit import AtexitIntegration
	from sentry_sdk.integrations.dedupe import DedupeIntegration
	from sentry_sdk.integrations.excepthook import ExcepthookIntegration
	from sentry_sdk.integrations.modules import ModulesIntegration
	from sentry_sdk.integrations.wsgi import SentryWsgiMiddleware

	from frappe.utils.sentry import FrappeIntegration, before_send

	integrations = [
		AtexitIntegration(),
		ExcepthookIntegration(),
		DedupeIntegration(),
		ModulesIntegration(),
		ArgvIntegration(),
	]

	kwargs = {}

	if os.getenv("ENABLE_SENTRY_DB_MONITORING"):
		integrations.append(FrappeIntegration())

	if tracing_sample_rate := os.getenv("SENTRY_TRACING_SAMPLE_RATE"):
		kwargs["traces_sample_rate"] = float(tracing_sample_rate)
		application = SentryWsgiMiddleware(application)

	if profiling_sample_rate := os.getenv("SENTRY_PROFILING_SAMPLE_RATE"):
		kwargs["profiles_sample_rate"] = float(profiling_sample_rate)

	sentry_sdk.init(
		dsn=sentry_dsn,
		before_send=before_send,
		attach_stacktrace=True,
		release=frappe.__version__,
		auto_enabling_integrations=False,
		default_integrations=False,
		integrations=integrations,
		**kwargs,
	)


def _tolerate_reloader_crashes():
	"""Keep `bench serve` alive when the restarted process crashes on boot.

	Werkzeug's reloader gives up permanently if the reloaded process exits with an
	error, e.g. when a file is saved with a syntax error halfway through an edit.
	Instead of exiting, keep watching files and attempt another restart on the next
	change.
	"""
	from werkzeug._internal import _log
	from werkzeug._reloader import ReloaderLoop

	original_restart = ReloaderLoop.restart_with_reloader

	def restart_with_reloader(self) -> int:
		while True:
			exit_code = original_restart(self)
			if exit_code == 0:
				return exit_code

			_log(
				"warning",
				f" * Server exited with code {exit_code}, waiting for a file change to restart it",
			)
			try:
				# Fresh instance because watchdog observers can't be restarted after use.
				with type(self)(
					extra_files=self.extra_files,
					exclude_patterns=self.exclude_patterns,
					interval=self.interval,
				) as watcher:
					watcher.run()
			except SystemExit as e:
				if e.code != 3:  # 3 = file changed, restart requested
					return exit_code

	ReloaderLoop.restart_with_reloader = restart_with_reloader


_RELOADER_EXCLUDED_DIRS = ("node_modules", ".git")


def _get_reloader_watch_config(sites_path) -> tuple[list[str], list[str]]:
	"""Keep the reloader from watching node_modules, .git and the sites directory.

	See #41147
	"""
	try:
		__import__("watchdog.observers")  # same check werkzeug uses to pick the reloader
	except ImportError:
		# The stat reloader polls only .py files and skips the venv already; the
		# watch-root surgery below would just make it walk the app packages twice.
		return [], ["test_*"]

	sites_dir = os.path.abspath(sites_path)
	extra_dirs = []
	exclude_patterns = ["test_*", sites_dir, *[f"*/{d}/*" for d in _RELOADER_EXCLUDED_DIRS]]

	# the stat reloader never scans the venv or the stdlib; skip them here too
	prefixes = {sys.prefix, sys.exec_prefix, sys.base_prefix, sys.base_exec_prefix}
	exclude_patterns.extend(f"{os.path.abspath(p)}{os.sep}*" for p in prefixes)

	for path in sys.path:
		path = os.path.abspath(path)
		if path == sites_dir or not os.path.isdir(path):
			continue
		if not any(os.path.lexists(os.path.join(path, d)) for d in _RELOADER_EXCLUDED_DIRS):
			continue

		exclude_patterns.append(path)
		extra_dirs.extend(
			os.path.join(path, child)
			for child in sorted(os.listdir(path))
			if os.path.isfile(os.path.join(path, child, "__init__.py"))
		)

	return extra_dirs, exclude_patterns


def serve(
	port=8000,
	profile=False,
	no_reload=False,
	no_threading=False,
	site=None,
	sites_path=".",
	proxy=False,
):
	global application, _site, _sites_path
	_site = site
	_sites_path = sites_path

	from werkzeug.serving import run_simple

	if profile or os.environ.get("USE_PROFILER"):
		application = ProfilerMiddleware(application, sort_by=("cumtime", "calls"), restrictions=(200,))

	if not os.environ.get("NO_STATICS"):
		application = application_with_statics()

	if proxy or os.environ.get("USE_PROXY"):
		application = ProxyFix(application, x_for=1, x_proto=1, x_host=1, x_port=1, x_prefix=1)

	application.debug = True
	application.config = {"SERVER_NAME": "127.0.0.1:8000"}

	log = logging.getLogger("werkzeug")
	log.propagate = False

	in_test_env = os.environ.get("CI")
	if in_test_env:
		log.setLevel(logging.ERROR)

	use_reloader = False if in_test_env else not no_reload
	extra_dirs, exclude_patterns = [], ["test_*"]
	if use_reloader:
		_tolerate_reloader_crashes()
		extra_dirs, exclude_patterns = _get_reloader_watch_config(sites_path)

	run_simple(
		"0.0.0.0",
		int(port),
		application,
		extra_files=extra_dirs,
		exclude_patterns=exclude_patterns,
		use_reloader=use_reloader,
		use_debugger=False,
		use_evalex=False,
		threaded=not no_threading,
	)


def application_with_statics():
	global application, _sites_path

	application = SharedDataMiddleware(application, {"/assets": str(os.path.join(_sites_path, "assets"))})

	application = StaticDataMiddleware(application, {"/files": str(os.path.abspath(_sites_path))})

	return application
