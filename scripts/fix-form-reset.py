"""
Convert `<form action={async (fd) => {...}}>` to an onSubmit handler.

React resets a form with an `action` prop once the action resolves, whether it
succeeded or was refused. Every one of these forms is controlled by useState, so
the reset put the DOM back to its defaults while the React state driving the
helper text kept the old values — the form ended up contradicting itself and
throwing away what the user had typed, on the one path where they most need it
kept.

The form element is captured before the first await, because `e.currentTarget`
is null by the time an async handler resumes.
"""
import io
import os
import re

CONVERTED = []
SKIPPED = []

pattern = re.compile(r'action=\{async \(fd\) => \{', re.S)


def convert(path):
    src = io.open(path, encoding="utf-8").read()
    if "action={async (fd) =>" not in src:
        return
    out = src.replace(
        "action={async (fd) => {",
        "onSubmit={async (e) => {\n            e.preventDefault();\n"
        "            const form = e.currentTarget;\n"
        "            const fd = new FormData(form);",
    )
    if out != src:
        io.open(path, "w", encoding="utf-8", newline="\n").write(out)
        CONVERTED.append(path)


for root, _, files in os.walk("src"):
    for fn in files:
        if fn.endswith(".tsx"):
            convert(os.path.join(root, fn).replace("\\", "/"))

print(f"converted {len(CONVERTED)} files")
for p in CONVERTED:
    print("  ", p)
