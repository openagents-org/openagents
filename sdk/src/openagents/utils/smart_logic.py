from typing import Any, Optional, Dict
from openagents.lms.providers import BaseModelProvider


class SmartLogicHelper:
    """
    A utility class to help with smart logic such as extracting information, judging conditions, etc. using LLMs.
    """

    def __init__(self, llm: BaseModelProvider):
        self.llm = llm
    
    def _get_llm_response(self, response: Dict[str, Any]) -> str:
        """
        Get the response from the LLM.
        """
        if isinstance(response, dict) and "content" in response:
            return response["content"].strip()
        elif hasattr(response, "content"):
            return response.content.strip()
        elif isinstance(response, str):
            return response.strip()
        return str(response)
    
    async def prompt(self, prompt: str) -> str:
        """
        Prompt the LLM with the given prompt.
        """
        messages = [
            {"role": "user", "content": prompt}
        ]
        response = await self.llm.chat_completion(messages)
        return self._get_llm_response(response)

    async def extract(self, text: str, information_type: str) -> Optional[str]:
        """
        Extract information from the given text using the LLM.
        If the information is not present, return None.
        """
        prompt = (
            f"You are an expert information extractor.\n"
            f"Extract the following type of information from the given text:\n"
            f"Information type: {information_type}\n"
            f"Text: {text}\n"
            f"If the information is not present in the text, respond with 'NONE'.\n"
            f"Return only the extracted information, nothing else."
        )
        messages = [
            {"role": "user", "content": prompt}
        ]
        response = await self.llm.chat_completion(messages)
        result = self._get_llm_response(response)
        if result.strip().lower() in {"none", "n/a", "not found", ""}:
            return None
        return result
    
    async def judge(self, text: str, condition: str) -> bool:
        """
        Judge the given text based on the given condition using the LLM.
        """
        prompt = (
            f"You are a logical reasoning assistant.\n"
            f"Given the following text, answer YES or NO to the question below.\n"
            f"Text: {text}\n"
            f"Condition: {condition}\n"
            f"Answer only YES or NO."
        )
        messages = [
            {"role": "user", "content": prompt}
        ]
        response = await self.llm.chat_completion(messages)
        answer = self._get_llm_response(response).strip().lower()
        # Acceptable YES/NO variants
        if answer.startswith("yes"):
            return True
        elif answer.startswith("no"):
            return False
        # Fallback: try to parse as boolean
        if answer in {"true", "1"}:
            return True
        elif answer in {"false", "0"}:
            return False
        return False
    
    async def classify(self, text: str, labels: list) -> str:
        """
        Classify the given text into one of the provided labels using the LLM.

        Args:
            text: The text to classify.
            labels: A list of possible labels.

        Returns:
            The label as a string.
        """
        label_str = ", ".join(labels)
        prompt = (
            f"Classify the following text into one of these categories: {label_str}.\n"
            f"Text: {text}\n"
            f"Category:"
        )
        messages = [
            {"role": "user", "content": prompt}
        ]
        response = await self.llm.chat_completion(messages)
        return self._get_llm_response(response)
