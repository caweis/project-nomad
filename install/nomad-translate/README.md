# NOMAD Translated Library

This service forwards the Kiwix library on the same paths and translates text in English article pages. It leaves HTML tags, link targets, scripts, media, and non-article routes in place. The translator uses CTranslate2 on CPU with Argos model packages. The image is built for `linux/arm64` for the macOS distribution.

The Kiwix proxy and redirect handling adapt the translation service in [Crosstalk Solutions' Project NOMAD](https://github.com/Crosstalk-Solutions/project-nomad).

## Build and test

```sh
python3.11 -m unittest discover -s install/nomad-translate -p 'test_*.py' -v
docker build --platform linux/arm64 -t project-nomad-translate:local install/nomad-translate
```

The Supply Depot catalog points to `ghcr.io/caweis/project-nomad-translate:0.1.0` and connects the service to Kiwix on the NOMAD Docker network. The image publishing workflow is `.github/workflows/build-translate-service.yml`. Publish the versioned image before releasing the catalog entry.

## Models

On first start, the container downloads the selected English-to-French, English-to-Spanish, and English-to-German archives from the Argos package host into `/models`. The SHA-256 of each archive is pinned in `fetch_models.py`. The installer extracts only the tokenizer and CTranslate2 model files and verifies their hashes on later starts. The archives include other files that this service does not use.

`TRANSLATE_LANGS` is a comma-separated subset of `fr,es,de`; the default is all three. The mounted `/models` directory persists the models across container restarts. If a model download fails, the proxy still serves the Information Library untranslated and retries the model on the next start.

The image listens on port 8391. Set `KIWIX` to the Kiwix base URL; Supply Depot uses `http://nomad_kiwix_server:8080`. Only English source text is translated. Translation operates on text nodes so inline markup remains intact, though a short link label may have less context than the surrounding sentence. The original article is available through the **Original** button.
