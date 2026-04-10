# Feature: cardflow-platform, Property 13: Elemental Matrix correctness

from hypothesis import given, settings
from hypothesis import strategies as st

from app.utils.damage import ELEMENTAL_MATRIX, calculate_damage

ELEMENTS = ["Fire", "Grass", "Water", "Electric", "Air", "Earth", "Neutral"]

# All element pairs defined in the matrix with their expected multipliers
MATRIX_PAIRS = [
    (attacker, target, multiplier)
    for (attacker, target), multiplier in ELEMENTAL_MATRIX.items()
]


@given(
    pair=st.sampled_from(MATRIX_PAIRS),
    base_atk=st.integers(min_value=1, max_value=10_000),
)
@settings(max_examples=100)
def test_elemental_matrix_defined_pairs(pair, base_atk):
    """
    For each element pair in ELEMENTAL_MATRIX, calculate_damage should return
    exactly base_atk * expected_multiplier.

    Validates: Requirements 4.1, 4.2
    """
    attacker, target, expected_multiplier = pair
    result = calculate_damage(attacker, target, base_atk)
    assert result == base_atk * expected_multiplier, (
        f"calculate_damage({attacker!r}, {target!r}, {base_atk}) "
        f"expected {base_atk * expected_multiplier}, got {result}"
    )


@given(
    element=st.sampled_from(ELEMENTS),
    base_atk=st.integers(min_value=1, max_value=10_000),
)
@settings(max_examples=100)
def test_same_element_returns_1x(element, base_atk):
    """
    When attacker and target share the same element, calculate_damage should
    apply a 1x multiplier (i.e. return base_atk unchanged).

    Validates: Requirements 4.3
    """
    result = calculate_damage(element, element, base_atk)
    assert result == base_atk * 1.0, (
        f"Same-element pair ({element!r} vs {element!r}) with base_atk={base_atk} "
        f"expected {base_atk}, got {result}"
    )


@given(
    other_element=st.sampled_from(ELEMENTS),
    base_atk=st.integers(min_value=1, max_value=10_000),
)
@settings(max_examples=100)
def test_neutral_attacker_returns_1x(other_element, base_atk):
    """
    When the attacker element is Neutral, calculate_damage should apply a 1x
    multiplier regardless of the target element.

    Validates: Requirements 4.4
    """
    result = calculate_damage("Neutral", other_element, base_atk)
    assert result == base_atk * 1.0, (
        f"Neutral attacker vs {other_element!r} with base_atk={base_atk} "
        f"expected {base_atk}, got {result}"
    )


@given(
    other_element=st.sampled_from(ELEMENTS),
    base_atk=st.integers(min_value=1, max_value=10_000),
)
@settings(max_examples=100)
def test_neutral_target_returns_1x(other_element, base_atk):
    """
    When the target element is Neutral, calculate_damage should apply a 1x
    multiplier regardless of the attacker element.

    Validates: Requirements 4.4
    """
    result = calculate_damage(other_element, "Neutral", base_atk)
    assert result == base_atk * 1.0, (
        f"{other_element!r} attacker vs Neutral target with base_atk={base_atk} "
        f"expected {base_atk}, got {result}"
    )
