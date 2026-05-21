# Yoitomoshi Art Generator

[日本語](README.md) | [English](README.en.md) | [Русский](README.ru.md) | **Português**

Frontend pessoal para Stable Diffusion, criado para desenvolvimento de jogos. Roda o Stable Diffusion WebUI Forge em segundo plano e expõe geração, gerenciamento de assets e integração com Civitai através de uma UI personalizada em React/Electron.

> **Início rápido**: siga a seção "Inicialização — 3 passos" abaixo. O guia detalhado de setup é mantido em japonês em [`docs/SETUP_GUIDE.md`](docs/SETUP_GUIDE.md).

## Inicialização pelo GitHub — 4 passos

### 1. Obter o repositório

Com Git:

```powershell
git clone https://github.com/imonoonoko/Yoitomoshi-Art-Generator.git
cd Yoitomoshi-Art-Generator
```

Sem Git, use `Code` → `Download ZIP` no GitHub e extraia a pasta.

`runtime/`, `userdata/`, `node_modules/` e outputs de build não são incluídos. Prepare o Forge e os modelos localmente.

### 2. Pré-requisitos

| Necessário | Função |
|---|---|
| **Stable Diffusion WebUI Forge** | Já funcionando (`run.bat` inicia) — [página de releases](https://github.com/lllyasviel/stable-diffusion-webui-forge) |
| **Node.js 22.x (LTS)** | Runtime do app — instale a versão LTS de [nodejs.org](https://nodejs.org/) |
| **Windows 10/11** | Plataforma testada (Mac/Linux não testados) |
| **GPU NVIDIA** | Verificado em RTX 4060 Ti 8GB. Para SDXL recomenda-se `--medvram`. |

São necessários cerca de 5 GB livres de disco (node_modules + histórico de imagens geradas).

### 3. Iniciar com clique duplo

```
Clique duplo em  Yoitomoshi.bat  no Explorer
```

Apenas na primeira vez, o seguinte é executado automaticamente (3–5 minutos):

1. `npm install` — baixa dependências
2. `npm run build` — compila o app

Quando termina, a janela do Electron abre. Inicializações seguintes levam segundos.

> **Atalho na área de trabalho**: clique direito em [`create-desktop-shortcut.ps1`](create-desktop-shortcut.ps1) → "Executar com PowerShell" e um atalho aparecerá na área de trabalho.

### 4. Configuração inicial — apontar para o Forge

Clique no ícone ⚙ no canto superior direito da barra de título para abrir o modal de configurações:

| Campo | Descrição |
|---|---|
| **Caminho de instalação do Forge** | Caminho absoluto da pasta-mãe que contém `run.bat`. Padrão: `C:\宵灯工房アート\Yoitomoshi-Art-Generator\runtime\forge` |
| **Porta do Forge** | Padrão `7860` (mude se rodar o Forge em outra porta) |
| **Auto-iniciar** | Se ligado, Forge sobe junto com o Electron |
| **Chave de API do Civitai** | Opcional. Necessária para modelos NSFW e limites maiores. Gere na aba "API Keys" em [Civitai → Account](https://civitai.com/user/account). |

Após salvar, clique no botão de energia à esquerda da barra de título para iniciar o Forge em segundo plano (1–2 minutos na primeira execução, ao resolver dependências).

---

## Modo de desenvolvedor (hot reload)

Use isso só se quiser que mudanças no código apareçam imediatamente:

```powershell
cd C:\宵灯工房アート\Yoitomoshi-Art-Generator
npm install --no-audit --no-fund    # apenas na primeira vez
npm run dev                          # iniciar com HMR
```

No uso diário, `Yoitomoshi.bat` carrega os artefatos pré-compilados e inicia mais rápido.

## Onde os dados ficam

O app é portátil. Tudo abaixo fica em `userdata/` ao lado do projeto:

```
userdata/
├── settings.json              configurações (caminho do Forge, chave API, …)
├── presets.json               presets de prompt
├── quick-presets.json         quick-presets do usuário
├── hidden-quick-presets.json  IDs de presets nativos ocultos
├── favorites.json             tags favoritadas
├── lora-favorites.json        LoRAs favoritadas
├── lora-usage.json            histórico de uso de LoRA (auto-sugestão)
├── custom-prompt-library.json categorias/tags adicionadas pelo usuário
├── civitai/                   cache de metadados do Civitai
│   ├── <sha256>.json          por checkpoint
│   ├── lora-<sha256>.json     por LoRA
│   ├── community-<id>.json    agregados da comunidade
│   ├── update-check.json      checagem de updates (TTL 24h)
│   └── tags.json              cache de tags populares (TTL 24h)
└── history/                   histórico de gerações
    ├── index.json
    └── <uuid>.png             cada imagem gerada (máx. 500)
```

Mova **a pasta inteira do projeto** para outro disco ou PC — configurações, histórico e cache vão junto.

## Destaques

| Área | Recursos |
|---|---|
| Geração | txt2img / img2img / Video / Upscale / arrastar-e-soltar + Ctrl+V / lote |
| Modelos | Workspace dedicado para thumbnails de modelos/LoRA, metadados Civitai, favoritos e notas |
| Parâmetros | Sampler / Steps / CFG / Size / Seed / Clip Skip / VAE / Denoising / ajuste fino de peso (Ctrl+↑↓) |
| Prompts | Biblioteca nativa de tags (prompt-all-in-one MIT) + adições do usuário / autocompletar / contador de tokens / syntax highlight / quick presets |
| LoRA | UI de cards / multi-LoRA / auto-sugestão (recomendações do modelo +200) / inserção automática de trigger-words |
| Civitai | Busca/download de modelos/LoRA/VAE / agregação de 200 imagens da comunidade / notificação de updates / navegador de tags |
| Parser de metadados | Extração de PNG/JPEG/WebP / colar texto rotulado / cruzar modelo/LoRA/VAE com Civitai |

## Desenvolvimento/build

```powershell
# Type-check do TypeScript
npm run typecheck

# Build de produção
npm run build

# Empacotar (executável Electron)
npm run dist
```

## Solução de problemas

### O navegador abre sozinho
Antes de iniciar, o app reescreve `webui/config.json` do Forge para definir `auto_launch_browser` como `Disable`. Se ainda assim o navegador abre, o Forge está sendo iniciado por outro caminho — verifique se "Forge extra args" no modal de configurações não contém algo como `--api`.

### "Running on local URL" não aparece
- Confirme o caminho de instalação do Forge (`<path>/webui/launch.py` deve existir)
- Conflito de porta: outra instância do Forge ou outro app já usa 7860
- Atualizações de dependências do Forge podem levar alguns minutos na primeira execução

### "Falha ao parsear metadados" → "não é um PNG"
Imagens que passaram por SNS/CDN frequentemente perdem EXIF. Use "Parsear de texto" e cole uma string de parâmetros formato A1111 ou formato "label + nova linha + valor".

### Os mesmos erros de extensão se repetem
Clique no ⚠️ da barra de título → "Desativar" para adicionar o nome da extensão a `disabled_extensions` em `webui/config.json` do Forge. Reinicie o Forge para aplicar.

### Recomendações do modelo parecem desatualizadas
O cache fica em `userdata/civitai/<sha>.json` com TTL de 14 dias. Apague o arquivo para forçar uma nova busca na próxima seleção. Igual para agregados da comunidade (`community-<id>.json`).

## Licença & terceiros

- O `resources/prompt-library.ja.yaml` incluído vem de [Physton/sd-webui-prompt-all-in-one](https://github.com/Physton/sd-webui-prompt-all-in-one) (MIT)
- Dependências principais: Electron / electron-vite / Vite 7 / React 19 / Tailwind / Radix UI / Zustand / js-yaml / lucide-react

## Limitações conhecidas

- **Distribuição limitada**: feito para uso pessoal, não para distribuição pública geral
- **Filtro NSFW só na busca do Civitai**: a geração em si não é moderada (responsabilidade do Forge / do modelo)
- **Metadados PNG**: só formato A1111 / Forge (chunk `parameters` / EXIF UserComment)
- **Mac/Linux não testados**: o código é multiplataforma, mas a inicialização do Forge assume Windows

## Contato

Reporte bugs / pedidos diretamente ao mantenedor (sem issue tracker público — projeto pessoal).
