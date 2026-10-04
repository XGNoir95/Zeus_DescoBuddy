"""Use OS and packaged trust roots, never disable HTTPS verification."""

import os
import socket
import ssl
import sys
from pathlib import Path

import certifi
import httpx
from telegram.request import HTTPXRequest

DESCO_INTERMEDIATE = Path(__file__).with_name("certs") / "digicert-global-g2-tls-rsa-sha256-2020-ca1.pem"


def tls_context(*, desco=False):
    context = ssl.create_default_context()
    context.load_verify_locations(certifi.where())
    if desco:
        # DESCO currently omits this intermediate from its server chain.
        # Its issuer is the existing DigiCert Global Root G2 trust anchor.
        context.load_verify_locations(str(DESCO_INTERMEDIATE))
    return context


def telegram_request():
    return HTTPXRequest(httpx_kwargs={"verify": tls_context()})


def connection_reason(exc):
    """Classify nested transport errors without exposing URLs or proxy credentials."""
    chain = []
    seen = set()
    while exc is not None and id(exc) not in seen:
        seen.add(id(exc))
        chain.append(exc)
        exc = exc.__cause__ or exc.__context__
    detail = " ".join(str(item).lower() for item in chain)
    if "certificate_verify_failed" in detail or any(
        isinstance(e, ssl.SSLCertVerificationError) for e in chain
    ):
        return "HTTPS certificate verification failed"
    if any(isinstance(e, socket.gaierror) for e in chain) or "getaddrinfo failed" in detail:
        return "DNS lookup failed"
    if any(isinstance(e, (httpx.TimeoutException, TimeoutError)) for e in chain):
        return "connection timed out"
    if any(getattr(e, "winerror", None) == 10013 or getattr(e, "errno", None) in (13, 10013) for e in chain):
        return "network access denied by Windows"
    if any(isinstance(e, ConnectionRefusedError) for e in chain):
        return "connection refused"
    if any(isinstance(e, ssl.SSLError) for e in chain) or "ssl" in detail:
        return "TLS handshake failed"
    return type(chain[0]).__name__ if chain else "unknown connection failure"


async def network_check():
    from dotenv import load_dotenv

    load_dotenv()
    print("Python:", sys.executable)
    names = [
        key
        for key in os.environ
        if key.upper()
        in {"HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "SSL_CERT_FILE", "SSL_CERT_DIR"}
    ]
    print("Network environment settings (names only):", ", ".join(names) or "none")
    try:
        context = tls_context(desco=True)
    except Exception as exc:
        print("Trust store setup:", connection_reason(exc))
        return
    async with httpx.AsyncClient(verify=context, timeout=15) as client:
        for label, url in (
            ("DESCO portal", "https://prepaid.desco.org.bd/customer/"),
            ("DESCO API", "https://prepaid.desco.org.bd/api/tkdes/customer/getBalance?accountNo=0000000000"),
            ("Telegram HTTPS", "https://api.telegram.org/"),
        ):
            try:
                response = await client.get(url)
                print(f"{label}: HTTP {response.status_code} (HTTPS connection succeeded)")
            except Exception as exc:
                print(f"{label}: {connection_reason(exc)}")
