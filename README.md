# Country Map Quiz

A static multiple-choice geography quiz based on the earlier Flag Quiz concept.
Each 15-question round shows a country outline with neighboring borders and asks
the player to identify the country from four choices.

## Run Locally

```bash
python3 -m http.server 4173
```

Then open:

```text
http://localhost:4173
```

## Notes

- Map data is vendored from `world-atlas` in `assets/maps/countries-50m.json`.
- Rendering uses local copies of D3 and `topojson-client` in `assets/vendor/`.
- Small island countries are kept out of the quiz pool; larger island countries
  such as Sri Lanka, Taiwan, and Madagascar are allowed.
- The design direction comes from the new Google Stitch project `Country Map Quiz`
  with the generated `Modern Atlas` visual system.
