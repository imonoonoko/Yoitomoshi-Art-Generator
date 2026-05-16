# Third-Party Notices

This project is distributed under the MIT License. Some files and dependencies are provided under their own licenses.

## Bundled Prompt Library

`resources/prompt-library.ja.yaml` is derived from:

- Project: `Physton/sd-webui-prompt-all-in-one`
- URL: https://github.com/Physton/sd-webui-prompt-all-in-one
- License: MIT

`resources/prompt-library.yoitomoshi.ja.yaml` contains Yoitomoshi-specific additions and is covered by this repository's MIT License.

## npm Dependencies

The application uses npm packages listed in `package.json` and locked in `package-lock.json`.

Direct dependency license summary at the time of this notice:

| Package | License |
|---|---|
| `@radix-ui/react-dropdown-menu` | MIT |
| `@radix-ui/react-slider` | MIT |
| `@radix-ui/react-tabs` | MIT |
| `@radix-ui/react-tooltip` | MIT |
| `clsx` | MIT |
| `electron` | MIT |
| `electron-builder` | MIT |
| `electron-vite` | MIT |
| `js-yaml` | MIT |
| `lucide-react` | ISC |
| `react` | MIT |
| `react-dom` | MIT |
| `react-hot-toast` | MIT |
| `tailwind-merge` | MIT |
| `typescript` | Apache-2.0 |
| `vite` | MIT |
| `zustand` | MIT |

The transitive dependency lockfile currently includes mostly MIT / ISC / BSD / Apache-2.0 packages, plus a small number of permissive or attribution-style licenses such as BlueOak-1.0.0, CC-BY-4.0, Python-2.0, WTFPL, and CC0-compatible dual licenses. See `package-lock.json` for the exact package versions and license fields.

## External Runtime and Models

This repository does not include Stable Diffusion WebUI Forge, model weights, LoRA files, ControlNet models, generated images, Civitai metadata caches, or user settings.

Those assets live under local folders such as `runtime/`, `userdata/`, and `output/`, which are intentionally excluded from Git. Their licenses and usage terms are controlled by their original authors and distribution sites.

## External Services

Yoitomoshi Art Generator can connect to services such as Civitai and Hugging Face to search or download assets. Users are responsible for following each service's terms and each downloaded asset's license.
