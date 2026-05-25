# Purpose

Reduce perceived and measured Forge startup latency and improve steady-state responsiveness for the personal Yoitomoshi Forge Studio workflow.

The main target is `Forge ready`, not Electron renderer load. The renderer is already fast; Forge startup is dominated by Python/Torch initialization, extension loading, ControlNet initialization, checkpoint/VAE load, and API readiness polling.
