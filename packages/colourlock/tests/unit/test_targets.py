import numpy as np
import pytest

from colourlock.targets import TARGETS, target_from_hex


def test_eight_targets_present():
    assert len(TARGETS) == 8
    assert set(TARGETS) == {
        "royal_blue", "firebrick_red", "forest_green", "goldenrod",
        "dark_orchid", "sienna_brown", "teal", "crimson",
    }


def test_royal_blue_hex_and_lab():
    t = TARGETS["royal_blue"]
    assert t.hex == "4169E1"
    # sRGB #4169E1 -> Lab, computed independently via skimage for this test.
    from skimage.color import rgb2lab
    expected = rgb2lab(np.array([[[0x41, 0x69, 0xE1]]], dtype=float) / 255.0).reshape(3)
    np.testing.assert_allclose(t.lab, expected, atol=1e-6)


def test_target_from_hex_roundtrip():
    t = target_from_hex("#DC143C")
    assert t.hex == "DC143C"
    np.testing.assert_allclose(t.lab, TARGETS["crimson"].lab, atol=1e-6)


def test_target_from_hex_rejects_bad_input():
    with pytest.raises(ValueError):
        target_from_hex("#ABC")
