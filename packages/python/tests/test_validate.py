import unittest

from wan30 import WanClientError
from wan30.validate import validate_generation_input, validate_request_id


def lake(**extra):
    value = {
        "modelId": "wan30-text-to-video",
        "prompt": "A paper boat on a rainy street",
    }
    value.update(extra)
    return value


class ValidateTests(unittest.TestCase):
    def test_published_ranges(self):
        validate_generation_input(lake(durationSeconds=2, resolution="1080p", aspectRatio="9:16", hasAudio=False))
        validate_generation_input(lake(durationSeconds=30, resolution="720p", aspectRatio="3:4", hasAudio=True))
        validate_generation_input(
            {
                "prompt": "Move closer",
                "imageUrls": ["https://example.org/a.jpg"],
            }
        )
        validate_generation_input(
            {
                "modelId": "wan30-image-to-video",
                "prompt": "The crane takes off",
                "imageUrls": ["https://example.org/first-frame.jpg"],
            }
        )
        validate_generation_input(
            {
                "modelId": "wan30-reference-to-video",
                "prompt": "pan",
                "imageUrls": [f"https://example.org/{index}.jpg" for index in range(10)],
            }
        )
        validate_request_id("a" * 16)
        validate_request_id("forest-lake-shot-001")
        validate_request_id("A" * 128)

    def test_rejects_schema_mismatches(self):
        samples = [
            lake(prompt=""),
            lake(prompt="a" * 1501),
            lake(durationSeconds=1),
            lake(durationSeconds=31),
            lake(durationSeconds=True),
            lake(resolution="4k"),
            lake(aspectRatio="21:9"),
            lake(hasAudio="yes"),
            lake(imageUrls=["https://example.org/a.jpg"]),
            lake(extra=True),
            {"modelId": "wan30-image-to-video", "prompt": "x", "imageUrls": ["https://example.org/a.jpg", "https://example.org/b.jpg"]},
            {"modelId": "wan30-image-to-video", "prompt": "x"},
            {"modelId": "wan30-reference-to-video", "prompt": "x", "imageUrls": []},
            {"modelId": "wan30-reference-to-video", "prompt": "x", "imageUrls": [f"https://example.org/{i}.jpg" for i in range(11)]},
            {"modelId": "wan30-image-to-video", "prompt": "x", "imageUrls": ["http://example.org/a.jpg"]},
            {"prompt": "x"},
            {"modelId": "wan2.1-t2v-plus", "prompt": "x"},
            "lake",
        ]
        for sample in samples:
            with self.subTest(sample=sample):
                with self.assertRaises(WanClientError) as caught:
                    validate_generation_input(sample)
                self.assertEqual(caught.exception.code, "INVALID_INPUT")

    def test_prompt_length_matches_javascript_utf16_units(self):
        validate_generation_input(lake(prompt="😀" * 750))
        with self.assertRaises(WanClientError):
            validate_generation_input(lake(prompt="😀" * 751))

    def test_request_id_pattern(self):
        for value in ("short", "a" * 15, "a" * 129, "has space in id!!", "ok_" + "a" * 12, None, 16):
            with self.subTest(value=value):
                with self.assertRaises(WanClientError) as caught:
                    validate_request_id(value)
                self.assertEqual(caught.exception.code, "INVALID_INPUT")


if __name__ == "__main__":
    unittest.main()
