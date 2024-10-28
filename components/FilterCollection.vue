<template>
  <div class="sidebar-section">
    <h4 class="title">
      {{ $t('listingLayout.collections') }}
    </h4>
    <div>
      <label
        class="block mtb-10"
        v-for="(value, key) in collections"
        :key="key"
        :for="`collection-${value.id}`"
      >
        <input
          :id="`collection-${value.id}`"
          type="checkbox"
          v-model="collection"
          :value="value.id"
          @change="collectionChanged"
        >
        {{ value.title }}
      </label>
    </div>
  </div>
</template>

<script>


    export default {
      name: "FilterCollection",
      props: {
        collections: {
          type: Array,
          default() {
            return []
          }
        },
      },
      data() {
        return {
          collection: []
        }
      },
      components: {

      },
      mixins: [],
      computed: {

      },
      mounted() {
        if (this.$route.query.collection) {
          this.collection = this.$route.query.collection.split(',')
        }
      },
      methods: {
        collectionChanged() {
          let filtered = Object.assign({}, this.$route.query)
          if (this.collection.length) {
            filtered = {...filtered, ...{collection: this.collection.join(',')}}
          } else {
            delete filtered.collection
          }
          this.$emit('reset-route', filtered)
        },
      },
    }
</script>

<style scoped>

</style>
