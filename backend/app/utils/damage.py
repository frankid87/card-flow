ELEMENTAL_MATRIX: dict[tuple[str, str], float] = {
    ("Fire",     "Grass"):    2.0,
    ("Grass",    "Fire"):     0.5,
    ("Grass",    "Water"):    2.0,
    ("Water",    "Grass"):    0.5,
    ("Water",    "Fire"):     2.0,
    ("Fire",     "Water"):    0.5,
    ("Electric", "Air"):      2.0,
    ("Air",      "Electric"): 0.5,
    ("Air",      "Earth"):    2.0,
    ("Earth",    "Air"):      0.5,
    ("Earth",    "Electric"): 2.0,
    ("Electric", "Earth"):    0.5,
}


def calculate_damage(attacker_element: str, target_element: str, base_atk: int) -> float:
    """Returns base_atk * elemental_multiplier for the given element pair.

    Any pair not in ELEMENTAL_MATRIX (same-element, Neutral, or unrelated pairs)
    defaults to a 1x multiplier.
    """
    multiplier = ELEMENTAL_MATRIX.get((attacker_element, target_element), 1.0)
    return base_atk * multiplier
