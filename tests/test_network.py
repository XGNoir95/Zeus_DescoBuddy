import socket
import ssl

import httpx

from descobuddy.network import connection_reason, tls_context


def test_nested_certificate_failure_hides_sensitive_error_text():
    error = httpx.ConnectError("https://private.example/SECRET-TOKEN")
    error.__cause__ = ssl.SSLCertVerificationError(1, "certificate verify failed")
    assert connection_reason(error) == "HTTPS certificate verification failed"


def test_dns_failure_distinguished_from_generic_connection_failure():
    error = httpx.ConnectError("private proxy URL")
    error.__cause__ = socket.gaierror(11001, "getaddrinfo failed")
    assert connection_reason(error) == "DNS lookup failed"
    assert connection_reason(httpx.ConnectError("SECRET")) == "ConnectError"


def test_desco_chain_loads_without_windows_store_and_preserves_verification(monkeypatch):
    monkeypatch.setattr(ssl, "create_default_context", lambda: ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT))
    standard = tls_context()
    desco = tls_context(desco=True)
    assert desco.verify_mode == ssl.CERT_REQUIRED
    assert desco.check_hostname is True
    assert len(desco.get_ca_certs()) == len(standard.get_ca_certs()) + 1
