<!-- @app
{
  "title": "My Mini App v1.1",
  "name": "MiniApp",
  "icon": "items/redstone.png",
  "description": "This is a self-contained component app",
  "version": "1.0.0",
  "permission": "guest",
  "singleWindow": false,
  "height": 200,
  "width": 400,
  "isClosable": true
}
-->

<template>
  <Menubar>
    <MenubarMenu>
      <MenubarTrigger>Files</MenubarTrigger>
      <MenubarContent>
        <MenubarItem>
          New Tab <MenubarShortcut>⌘T</MenubarShortcut>
        </MenubarItem>
        <MenubarItem>
          New Window <MenubarShortcut>⌘N</MenubarShortcut>
        </MenubarItem>
        <MenubarItem disabled>
          New Incognito Window
        </MenubarItem>
        <MenubarSeparator />
        <MenubarSub>
          <MenubarSubTrigger>Share</MenubarSubTrigger>
          <MenubarSubContent>
            <MenubarItem>Email link</MenubarItem>
            <MenubarItem>Messages</MenubarItem>
            <MenubarItem>Notes</MenubarItem>
          </MenubarSubContent>
        </MenubarSub>
        <MenubarSeparator />
        <MenubarItem>
          Print... <MenubarShortcut>⌘P</MenubarShortcut>
        </MenubarItem>
      </MenubarContent>
    </MenubarMenu>
  </Menubar>
  <div>
    Oh, {{world}} Wassup?
  </div>
</template>

<script setup>
const world = ref('Hello 🌍')
</script>

<style scoped>
/* Add your component styles here */
</style>
