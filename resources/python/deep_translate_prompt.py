#!/usr/bin/env python3
import json
import sys


def main() -> int:
    try:
        payload = json.loads(sys.stdin.read().lstrip("\ufeff"))
        source = str(payload.get("source") or "ja")
        target = str(payload.get("target") or "en")
        texts = payload.get("texts")
        if texts is None:
            texts = [payload.get("text") or ""]
        if not isinstance(texts, list):
            raise ValueError("texts must be a list")

        from deep_translator import GoogleTranslator

        translator = GoogleTranslator(source=source, target=target)
        translated = []
        warnings = []
        for item in texts:
            text = str(item or "").strip()
            if not text:
                translated.append("")
                continue
            result = translator.translate(text=text)
            if not isinstance(result, str) or not result.strip():
                warnings.append("empty-translation-result")
                translated.append(text)
            else:
                translated.append(result.strip())

        print(json.dumps({
            "ok": True,
            "provider": "deep-translator-google",
            "translatedTexts": translated,
            "warnings": warnings,
        }, ensure_ascii=False))
        return 0
    except Exception as exc:
        print(json.dumps({
            "ok": False,
            "error": str(exc),
        }, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
