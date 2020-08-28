import unittest

from tmc import points
from tmc.utils import load

module_name = "src.failing_exercise"
hello = load(module_name, "hello")

@points("1.failing_exercise")
class FailingExercise(unittest.TestCase):

    def test_failing(self):
        self.fail()

if __name__ == "__main__":
    unittest.main()
