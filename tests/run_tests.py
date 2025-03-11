import unittest
import sys
import os

# Add the src directory to the path so we can import openagents
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../../')))

# Import test modules
from openagents.tests.test_agent import TestAgent
from openagents.tests.test_network import TestNetwork
from openagents.tests.test_discovery_protocol import TestDiscoveryNetworkProtocol, TestDiscoveryAgentProtocol

# Create a test suite
def create_test_suite():
    test_suite = unittest.TestSuite()
    
    # Add tests
    test_suite.addTest(unittest.makeSuite(TestAgent))
    test_suite.addTest(unittest.makeSuite(TestNetwork))
    test_suite.addTest(unittest.makeSuite(TestDiscoveryNetworkProtocol))
    test_suite.addTest(unittest.makeSuite(TestDiscoveryAgentProtocol))
    
    return test_suite

if __name__ == "__main__":
    # Run the tests
    runner = unittest.TextTestRunner(verbosity=2)
    test_suite = create_test_suite()
    runner.run(test_suite) 