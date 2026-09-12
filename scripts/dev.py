"""Run the local API and Vite together. Use the project virtual environment."""

import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
env = os.environ.copy()
# Explicit local demo runner; main.py itself defaults to DEMO_MODE=0.
env.setdefault("DEMO_MODE", "1")
env.setdefault(
    "CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173,http://localhost:8081"
)
processes = []
try:
    print(
        "MaterialSetu local development | Web http://localhost:5173 | API http://localhost:8000/docs",
        flush=True,
    )
    print("DEMO_MODE=" + env["DEMO_MODE"] + " — demo data is fictional.", flush=True)
    processes.append(
        subprocess.Popen(
            [
                sys.executable,
                "-m",
                "uvicorn",
                "main:app",
                "--host",
                "0.0.0.0",
                "--port",
                "8000",
                "--reload",
            ],
            cwd=ROOT / "services/api",
            env=env,
        )
    )
    npm = shutil.which("npm.cmd" if os.name == "nt" else "npm")
    if not npm:
        raise RuntimeError("Install Node.js and npm first.")
    processes.append(
        subprocess.Popen(
            [npm, "run", "dev", "--", "--host", "0.0.0.0"], cwd=ROOT, env=env
        )
    )
    while all(p.poll() is None for p in processes):
        time.sleep(0.5)
except KeyboardInterrupt:
    pass
finally:
    for process in processes:
        if process.poll() is None:
            process.terminate()
    for process in processes:
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
