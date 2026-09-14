---
name: vaul/radix Drawer bottom-sheet e2e click flakiness
description: Playwright-driven testing subagent sees intermittent click failures on vaul/radix Drawer bottom sheets right after they open or right after an option is clicked.
---

When a testing subagent drives a vaul/radix `Drawer.Root` bottom sheet (used
throughout シフト先生 for menus/pickers/warnings), clicking an option
immediately after the sheet opens — or asserting the sheet closed
immediately after clicking an option — is flaky: the slide-in/slide-out
transition hasn't settled yet, so the locator can miss or the assertion can
fire mid-animation.

**Why:** the drawer's open/close is animated (translate transition), and a
synthetic click during that window can land on a moving target or race the
close.

**How to apply:** when writing a test plan that interacts with a bottom
sheet, explicitly tell the tester to wait ~500-800ms after the sheet opens
before clicking, and again after clicking an option before asserting the
sheet closed / the underlying state changed. This is a test-timing quirk,
not an app bug — don't treat a flaky first run as a real bug without ruling
this out first.
