import unittest

from tmc import points
from tmc.utils import load

module_name = "src.passing_exercise"
hello = load(module_name, "hello")

@points("1.passing_exercise")
class PassingExercise(unittest.TestCase):

    def test_passing(self):
        self.assertEqual(hello(), "Hello world!")

if __name__ == "__main__":
    unittest.main()
