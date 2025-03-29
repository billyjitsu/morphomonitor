class TelegramNotifier {
  constructor(token, channel) {
    this.token = token;
    this.channel = channel;
  }

  async sendMessage(message) {
    try {
      // Using POST method with JSON body for better handling of special characters and formatting
      const request = await fetch(
        `https://api.telegram.org/bot${this.token}/sendMessage`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            chat_id: this.channel,
            text: message,
            parse_mode: "HTML" 
          })
        }
      );

      const response = await request.json();
      return response;
    } catch (error) {
      console.error("Error sending Telegram message:", error);
      return null;
    }
  }
}

module.exports = TelegramNotifier;