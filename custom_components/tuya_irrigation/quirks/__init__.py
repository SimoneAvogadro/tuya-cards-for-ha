"""ZHA custom quirks bundled with the Tuya Irrigation integration.

Importing this package as a side-effect registers each quirk class with
zigpy's global `DEVICE_REGISTRY` (for `CustomDevice` subclasses) or with
the QuirksV2 builder registry (for `add_to_registry()` calls). ZHA then
applies them on device join / interrogation, exactly as if they had been
dropped into the path configured by `zha.custom_quirks_path`.

The integration's top-level `__init__.py` imports this package at module
load time so the registration happens before ZHA enumerates devices.
"""

from . import giex_qt06_epoch2000  # noqa: F401  -- import for side-effect
from . import hobeian_zg303z       # noqa: F401  -- import for side-effect
from . import tuya_ts0001_fdxihpp7  # noqa: F401  -- import for side-effect
