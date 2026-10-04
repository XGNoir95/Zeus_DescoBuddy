DESCO's HTTPS server was verified on 2026-10-03 to send only its leaf
certificate. Python/OpenSSL does not automatically fetch its missing issuer.

The bundled intermediate was downloaded from the leaf certificate's DigiCert
CA Issuers address, using HTTPS:
https://cacerts.digicert.com/DigiCertGlobalG2TLSRSASHA2562020CA1-1.crt

Its signature was verified against DigiCert Global Root G2 in certifi.
It expires on 2031-03-29. Hostname and certificate verification remain enabled.
No leaf certificate or private key is bundled. The intermediate is loaded only
for DESCO requests (and the network diagnostic).
