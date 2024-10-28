<template>
  <nav aria-label="breadcrumb">
    <ol
      class="breadcrumb"
      itemscope
      itemtype="https://schema.org/BreadcrumbList"
    >

      <li
        itemprop="itemListElement"
        itemscope
        itemtype="https://schema.org/ListItem"
      >
        <nuxt-link
          to="/"
          itemprop="item"
        >
          <span itemprop="name">{{ $t('product.home') }}</span>
        </nuxt-link>

        <meta itemprop="position" content="1">
      </li>

      <li
        v-for="(value, i) in slugs"
        itemprop="itemListElement"
        itemscope
        itemtype="https://schema.org/ListItem"
        :key="i"
      >
        <nuxt-link
          :title="value.title"
          :to="value.link"
          itemprop="item"
        >
          <span itemprop="name">{{ value.title }}</span>
        </nuxt-link>

        <meta itemprop="position" :content="i+2">
      </li>


      <li class="breadcrumb-item"
          itemprop="itemListElement"
          itemscope
          itemtype="https://schema.org/ListItem"
      >
        <span itemprop="name">{{ page }}</span>
        <meta itemprop="position" :content="slugs.length + 2">
      </li>

    </ol>
  </nav>
</template>

<script>
  export default {
    name: 'Breadcrumb',
    data() {
      return {
      }
    },
    props: {
      page: {
        type: String,
        required: true
      },
      slugs: {
        type: Array,
        default() {
          return []
        }
      },

    },
    computed: {

    },
    mounted() {

    },
    destroyed() {
    }
  }
</script>
