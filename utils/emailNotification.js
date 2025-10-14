import nodemailer from "nodemailer";

export async function sendEmail({ to, subject, text }) {
  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    const info = await transporter.sendMail({
      from: `"Alertify" <${process.env.EMAIL_USER}>`,
      to,
      subject,
      text,
    });

    console.log(`Email sent to ${to}: ${info.response}`);
  } catch (error) {
    console.error("Failed to send email:", error.message);
  }
}
