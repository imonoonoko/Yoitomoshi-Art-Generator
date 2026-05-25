# Prompt Daijiten Large Dictionary Purpose

## Problem

The current Prompt Daijiten proves the workflow, but it is still a small YAML-backed dictionary. The target feature is much larger: a Japanese-first prompt dictionary where the user can type a concept such as "手" and immediately see relevant English prompt tags, Japanese translations, meanings, related tags, and insertion actions.

The main risk is data shape. A large dictionary with tens or hundreds of thousands of tags cannot be treated as a normal UI resource. Loading it into React state, merging it into the existing YAML prompt library, or editing it directly as one huge file would slow startup, make updates brittle, and make source/licensing boundaries hard to audit.

## Target User

Primary user is the Yoitomoshi creator working inside Yoitomoshi Forge Studio while composing anime/image-generation prompts. The user remembers Japanese concepts more naturally than exact English Danbooru-style tags and wants fast suggestions without opening external sites.

## Current Workaround

- Use the small built-in Prompt Daijiten YAML.
- Search the existing Prompt Library.
- Use external tag lists, Danbooru pages, CivitAI example prompts, or personal notes in another window.
- Manually translate Japanese intent into English prompt tags.

## Why Now

Prompt Daijiten already exists as a UI pattern. The next useful step is not more manual YAML, but a durable foundation for a high-volume dictionary that can later absorb Danbooru-style tags, Yoitomoshi-authored Japanese meanings, CivitAI prompt evidence, Animadex character/artist hints, and personal usage notes.

## Desired Outcome

Yoitomoshi gets a local, fast, Japanese-first prompt dictionary:

- Type "手" and see hands-related tags.
- Type "胸", "髪", "光", "座る", "後ろ姿", or English fragments and see useful English prompt tags.
- Each result explains what the tag means in Japanese and where it is useful.
- The user can insert into Positive, Negative, or Prompt Composer slots.
- The data can grow without hurting startup performance.
- Source provenance and user edits stay trackable.

## Success Definition

- Searching common Japanese concepts returns relevant English tags within interactive latency.
- The app does not load the full dictionary into renderer state at startup.
- Large dictionary data is versioned and queryable without making YAML or JSON monoliths.
- User corrections and favorites survive dictionary updates.
- Source/license information is available per imported source and, ideally, per entry.
