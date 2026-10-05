"""Entry point: `python -m calavera`."""
import os

import uvicorn

from .api import create_app

if __name__ == "__main__":
    uvicorn.run(
        create_app(),
        host=os.environ.get("CALAVERA_HOST", "0.0.0.0"),
        port=int(os.environ.get("CALAVERA_PORT", "8080")),
        log_level=os.environ.get("CALAVERA_LOG_LEVEL", "info"),
        access_log=False,
    )
