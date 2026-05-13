# Tagger Accuracy Comparison - 2026-05-14

## 結論

固定QA画像 5件と保存済みHistoryレビュー 0件、合計 5件に対し、期待タグと除外タグを基準に比較した。
これは正式な人手ラベル付きベンチマークではなく、Yoitomoshi Art Generatorの実運用で「プロンプト補助に使いやすいタグが返るか」を見るための実用精度比較である。

現時点の総合1位は **pixai-onnx**。平均スコアは **67.7%**、期待ラベル回収率は **75%**。
詳細な出力JSONは `output/tagger-accuracy-compare-2026-05-14/comparison.json` に保存した。

Historyレビューからは 0件を評価に取り込んだ。頻出除外タグ候補は **なし**。PixAIの推奨最低confidenceは **未算出**。

## 評価方法

- Coverage: 期待ラベル群のうち、上位出力タグで拾えた割合。
- Precision proxy: 上位25タグのうち、期待ラベル群に当たった割合。
- Rejected hit rate: 履歴レビューで除外タグに入れたタグが出力に混ざった割合。低いほど良い。
- Score: 固定QAは `0.7 * Coverage + 0.3 * Precision proxy`。履歴レビューは `0.6 * Coverage + 0.25 * Precision proxy + 0.15 * Rejected avoidance`。
- CLIPは自然文captionのため、タグ抽出器と同列ではなく参考値として扱う。
- 成人向け/露骨な履歴画像の内容文面をレポートに展開しないため、比較はQA素材中心で実施した。

## サマリー

| Rank | Provider | Score | Coverage | Precision proxy | Rejected hit | Avg elapsed ms | Avg tags | Samples |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | pixai-onnx | 67.7% | 75% | 50.8% | 0% | 4735 | 23 | 5/5 |
| 2 | wd14 | 65.5% | 68% | 59.6% | 0% | 906 | 15 | 5/5 |
| 3 | deepdanbooru | 31.6% | 37.5% | 17.8% | 0% | 404 | 22 | 5/5 |
| 4 | clip | 31.5% | 33% | 28% | 0% | 5124 | 5 | 5/5 |

## Historyレビュー反映

- History index: `userdata/history/index.json`
- Reviewed items: 0 / 100
- Included samples: 0
- Top rejected tags: なし
- Suggested blacklist candidates: なし
- PixAI recommended minimum confidence: 未算出

## サンプル別

| Sample | Provider | Status | Score | Coverage | Precision proxy | Rejected | Hits | Top tags |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| controlnet-source-man | pixai-onnx | PASS | 74.1% | 87.5% | 42.9% | 0/0 | 7/8 | 1boy, gun, solo, male focus, shirt, tent, weapon, facial hair |
| controlnet-source-man | deepdanbooru | PASS | 11.5% | 12.5% | 9.1% | 0/0 | 1/8 | border, light particles, night, night sky, shooting star, sky, space, standing |
| controlnet-source-man | clip | PASS | 38.3% | 37.5% | 40% | 0/0 | 3/8 | a man standing in front of a curtain with a cane in his hand and a pot in his other hand, a d m cooper, studio portrait, a colorized photo, harlem renaissance |
| controlnet-source-man | wd14 | PASS | 81.3% | 87.5% | 66.7% | 0/0 | 7/8 | 1boy, solo, male focus, monochrome, shirt, suspenders, sepia, pants |
| controlnet-gen-baseline | pixai-onnx | PASS | 51.7% | 50% | 55.6% | 0/0 | 4/8 | full body, solo, straight on, standing, 1boy, shirt, pants, male focus |
| controlnet-gen-baseline | deepdanbooru | PASS | 0% | 0% | 0% | 0/0 | 0/8 | long hair |
| controlnet-gen-baseline | clip | PASS | 20.8% | 12.5% | 40% | 0/0 | 1/8 | a pixel art picture of a man in a suit and tie holding a tablet computer in front of a glass case, adam manyoki, tech wear, a character portrait, computer art |
| controlnet-gen-baseline | wd14 | PASS | 60% | 50% | 83.3% | 0/0 | 4/8 | solo, 1boy, standing, male focus, shirt, full body |
| controlnet-gen-depth | pixai-onnx | PASS | 51.7% | 50% | 55.6% | 0/0 | 4/8 | full body, solo, 1boy, male focus, standing, black hair, looking at viewer, black eyes |
| controlnet-gen-depth | deepdanbooru | PASS | 23.1% | 25% | 18.8% | 0/0 | 2/8 | battle, building, candle, city, explosion, fire, firing, flame |
| controlnet-gen-depth | clip | PASS | 41% | 50% | 20% | 0/0 | 4/8 | a man in a long coat standing in a doorway with a light shining on him and a lamp on the floor, bedwyr williams, vfx, a matte painting, massurrealism |
| controlnet-gen-depth | wd14 | PASS | 50% | 50% | 50% | 0/0 | 4/8 | 1boy, solo, male focus, black hair, pants, standing, shirt, glasses |
| character-composite-after | pixai-onnx | PASS | 73.3% | 87.5% | 40% | 0/0 | 7/8 | night, motor vehicle, eyewear on head, car, lamppost, outdoors, road, street |
| character-composite-after | deepdanbooru | PASS | 45% | 50% | 33.3% | 0/0 | 4/8 | 1girl, blue eyes, building, cloud, jacket, long hair, night, outdoors |
| character-composite-after | clip | PASS | 23.5% | 25% | 20% | 0/0 | 2/8 | a street with a large cartoon character on the side of it at night time with a street light in the background, cui bai, gloomy atmosphere, a stock photo, net art |
| character-composite-after | wd14 | PASS | 58.8% | 62.5% | 50% | 0/0 | 5/8 | 1girl, eyewear on head, solo, black hair, night, blue eyes, road, outdoors |
| workspace-external-ref | pixai-onnx | PASS | 88% | 100% | 60% | 0/0 | 10/10 | pool, one piece swimsuit, competition swimsuit, pool ladder, wet, swimsuit, partially underwater shot, outdoors |
| workspace-external-ref | deepdanbooru | PASS | 78.4% | 100% | 28% | 0/0 | 10/10 | 1girl, bare shoulders, beach, black hair, blue sky, blue swimsuit, blush, boat |
| workspace-external-ref | clip | PASS | 34% | 40% | 20% | 0/0 | 4/10 | a woman in a blue swimsuit standing in a pool of water with a mountain in the background and a pool of water, chizuko yoshida, wet, a manga drawing, sots art |
| workspace-external-ref | wd14 | PASS | 77.4% | 90% | 48% | 0/0 | 9/10 | 1girl, swimsuit, solo, one piece swimsuit, outdoors, ponytail, one eye closed, wet |

## 判定

- **既定候補**: `pixai-onnx`。今回の固定QAサンプルでは最も期待ラベルを拾った。
- **UI方針**: PixAI/WD14/DeepDanbooruを切り替え比較できるUIは有効。CLIPは自然文説明として別枠にするのが扱いやすい。
- **次の改善**: Historyレビューが増えるほど、blacklist候補と最低confidenceの推奨値を実データで更新できる。除外タグが2回以上出たものから既定blacklistへ昇格するのが低リスク。

## 実行環境

- PixAI ONNX: `runtime/forge/webui/models/Tagger/model.onnx`
- PixAI tags: `runtime/forge/webui/models/Tagger/selected_tags.csv`
- Forge API: `http://127.0.0.1:7860` (ready)
- WD14 models: wd14-vit.v1, wd14-vit.v2, wd14-convnext.v1, wd14-convnext.v2, wd14-convnextv2.v1, wd14-swinv2-v1, wd-v1-4-moat-tagger.v2, mld-caformer.dec-5-97527, mld-tresnetd.6-30000
