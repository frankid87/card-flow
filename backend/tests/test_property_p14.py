# Feature: cardflow-platform, Property 14: calculate_damage always returns a positive value

from hypothesis import given, settings
from hypothesis import strategies as st

from app.utils.damage import calculate_damage

ELEMENTS = ["Fire", "Grass", "Water", "Electric", "Air", "Earth", "Neutral"]


@given(
    attacker_element=st.sampled_from(ELEMENTS),
    target_element=st.sampled_from(ELEMENTS),
    base_atk=st.integers(min_value=1, max_value=10_000),
)
@settings(max_examples=20, deadline=None)
def test_calculate_damage_always_positive(attacker_element, target_element, base_atk):
    """
    For any valid element pair and any positive base_atk, calculate_damage
    should return a value strictly greater than zero.

    Validates: Requirements 4.5
    """
    result = calculate_damage(attacker_element, target_element, base_atk)
    assert result > 0, (
        f"calculate_damage({attacker_element!r}, {target_element!r}, {base_atk}) "
        f"returned {result}, expected > 0"
    )
