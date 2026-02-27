require('dotenv').config();
const { Client, GatewayIntentBits, SlashCommandBuilder } = require('discord.js');
const express = require('express');
const crypto  = require('crypto');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
    ]
});

const app = express();
app.use(express.json());

// Simpan kode verifikasi sementara
// Map: code → { robloxUserId, discordUserId, expiresAt }
const pendingVerifications = new Map();

// ============================================================
// Discord Bot — Slash Command /getcode
// Player Discord ketik /getcode → dapat kode unik
// Lalu ketik /verify KODE di Roblox
// ============================================================

client.once('ready', async () => {
    console.log(`Bot online: ${client.user.tag}`);

    // Register slash command
    const command = new SlashCommandBuilder()
        .setName('getcode')
        .setDescription('Dapatkan kode untuk verifikasi akun Roblox kamu');

    await client.application.commands.create(command, process.env.GUILD_ID);
    console.log('Slash command /getcode terdaftar');
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== 'getcode') return;

    const discordUserId = interaction.user.id;

    // Cek apakah sudah punya kode aktif
    for (const [code, data] of pendingVerifications.entries()) {
        if (data.discordUserId === discordUserId && data.expiresAt > Date.now()) {
            await interaction.reply({
                content: `Kamu sudah punya kode aktif: \`${code}\`\nKetik di Roblox: \`/verify ${code}\`\nKode expired dalam ${Math.ceil((data.expiresAt - Date.now()) / 60000)} menit.`,
                ephemeral: true
            });
            return;
        }
    }

    // Buat kode baru (6 karakter random)
    const code = crypto.randomBytes(3).toString('hex').toUpperCase();
    const expiresAt = Date.now() + (10 * 60 * 1000); // 10 menit

    pendingVerifications.set(code, {
        discordUserId,
        expiresAt,
        robloxUserId: null,
    });

    // Auto hapus setelah expired
    setTimeout(() => pendingVerifications.delete(code), 10 * 60 * 1000);

    await interaction.reply({
        content: `Kode verifikasi kamu: \`${code}\`\n\nKetik di game Roblox:\n\`/verify ${code}\`\n\n⏳ Kode berlaku 10 menit.`,
        ephemeral: true  // hanya kamu yang lihat
    });
});

// ============================================================
// Express HTTP Server — endpoint untuk Roblox
// ============================================================

app.post('/verify', async (req, res) => {
    // Optional: cek secret key
    // const authHeader = req.headers['authorization'];
    // if (authHeader !== `Bearer ${process.env.SECRET_KEY}`) {
    //     return res.status(401).json({ verified: false, message: 'Unauthorized' });
    // }

    const { robloxUserId, code } = req.body;

    if (!robloxUserId || !code) {
        return res.status(400).json({ verified: false, message: 'Data tidak lengkap' });
    }

    const pending = pendingVerifications.get(code.toUpperCase());

    if (!pending) {
        return res.json({ verified: false, message: 'Kode tidak ditemukan atau sudah expired' });
    }

    if (pending.expiresAt < Date.now()) {
        pendingVerifications.delete(code);
        return res.json({ verified: false, message: 'Kode sudah expired' });
    }

    // Berikan role Verified di Discord
    try {
        const guild  = await client.guilds.fetch(process.env.GUILD_ID);
        const member = await guild.members.fetch(pending.discordUserId);

        await member.roles.add(process.env.VERIFIED_ROLE_ID);

        pendingVerifications.delete(code);

        console.log(`✅ Verified: Discord ${pending.discordUserId} → Roblox ${robloxUserId}`);

        return res.json({ verified: true, message: 'Berhasil diverifikasi!' });
    } catch (err) {
        console.error('Error giving role:', err);
        return res.json({ verified: false, message: 'Gagal memberikan role Discord' });
    }
});

// Health check
app.get('/', (req, res) => res.send('Bot is running!'));

// ============================================================
// Start
// ============================================================

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`HTTP server running on port ${PORT}`));

client.login(process.env.DISCORD_TOKEN);