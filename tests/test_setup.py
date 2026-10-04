from unittest.mock import patch

import pytest

from descobuddy.__main__ import setup


@pytest.mark.parametrize("token", ["", "bot123:abc", "BotFather says: 123456:secret", "123456:short"])
def test_bad_paste_rejected_before_network_or_save(token):
    with patch("descobuddy.__main__.getpass", return_value=token), patch("descobuddy.__main__.Bot") as bot:
        with pytest.raises(ValueError, match="No complete bot token") as error:
            setup()
        assert token not in str(error.value) or token == ""
        bot.assert_not_called()
