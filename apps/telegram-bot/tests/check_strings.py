"""AST check: every tr()/tr_user() call uses an existing key and supplies every {placeholder}."""
import ast, glob, re, string, sys
sys.path.insert(0, ".")
from guardbot.strings_en import STRINGS

problems, used = [], set()
for f in glob.glob("guardbot/**/*.py", recursive=True):
    tree = ast.parse(open(f, encoding="utf-8").read())
    for n in ast.walk(tree):
        if isinstance(n, ast.Call) and getattr(n.func, "id", "") in ("tr", "tr_user") and len(n.args) >= 2:
            a = n.args[1]
            if isinstance(a, ast.Constant) and isinstance(a.value, str):
                k = a.value; used.add(k)
                if k not in STRINGS:
                    problems.append(f"{f}:{n.lineno} missing key {k}"); continue
                if not n.keywords: continue
                need = {x[1] for x in string.Formatter().parse(STRINGS[k]) if x[1]}
                have = {kw.arg for kw in n.keywords if kw.arg}
                if any(kw.arg is None for kw in n.keywords): have |= need
                miss = need - have
                if miss: problems.append(f"{f}:{n.lineno} {k} lacks {sorted(miss)}")
unused = sorted(set(STRINGS) - used)
print("problems:", len(problems)); [print(" ", p) for p in problems]
print("unused keys (ok if used dynamically):", unused)
