# Homebrew formula for OpenAgents CLI
# Install: brew install openagents-org/tap/openagents
# Or:      brew tap openagents-org/tap && brew install openagents

class Openagents < Formula
  include Language::Python::Virtualenv

  desc "AI agent orchestration CLI — start, connect, and manage AI agents"
  homepage "https://openagents.org"
  url "https://files.pythonhosted.org/packages/source/o/openagents/openagents-0.8.6.tar.gz"
  sha256 "PLACEHOLDER"  # Update with actual sha256 after PyPI release
  license "Apache-2.0"

  depends_on "python@3.12"

  # Core dependencies (base install only, no SDK extras)
  resource "pydantic" do
    url "https://files.pythonhosted.org/packages/source/p/pydantic/pydantic-2.10.0.tar.gz"
    sha256 "PLACEHOLDER"
  end

  resource "typer" do
    url "https://files.pythonhosted.org/packages/source/t/typer/typer-0.15.0.tar.gz"
    sha256 "PLACEHOLDER"
  end

  resource "rich" do
    url "https://files.pythonhosted.org/packages/source/r/rich/rich-13.9.0.tar.gz"
    sha256 "PLACEHOLDER"
  end

  resource "click" do
    url "https://files.pythonhosted.org/packages/source/c/click/click-8.1.7.tar.gz"
    sha256 "PLACEHOLDER"
  end

  resource "pyyaml" do
    url "https://files.pythonhosted.org/packages/source/P/PyYAML/pyyaml-6.0.2.tar.gz"
    sha256 "PLACEHOLDER"
  end

  resource "aiohttp" do
    url "https://files.pythonhosted.org/packages/source/a/aiohttp/aiohttp-3.11.0.tar.gz"
    sha256 "PLACEHOLDER"
  end

  resource "requests" do
    url "https://files.pythonhosted.org/packages/source/r/requests/requests-2.32.0.tar.gz"
    sha256 "PLACEHOLDER"
  end

  def install
    virtualenv_install_with_resources
  end

  test do
    assert_match "openagents", shell_output("#{bin}/openagents version 2>&1")
  end
end
