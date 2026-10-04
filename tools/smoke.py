"""Read-only live network check using an intentionally invalid account identifier."""

import asyncio

from descobuddy.desco import DescoClient


async def check():
    client = DescoClient()
    try:
        for system in ("unified", "tkdes"):
            response = await client.request(system, "getBalance", "0000000000")
            if response is not None:
                raise RuntimeError("Unexpected data for invalid account; payload deliberately not displayed")
            print(f"{system}: HTTPS/JSON endpoint responded, invalid account safely returned no data.")
    finally:
        await client.close()


if __name__ == "__main__":
    asyncio.run(check())
